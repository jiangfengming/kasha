const Koa = require('koa')
const Router = require('koa-pilot')
const mount = require('koa-mount')
const serve = require('koa-static')
const send = require('koa-send')
const path = require('path')
const stoppable = require('stoppable')
const parseForwardedHeader = require('forwarded-parse')
const { bool } = require('cast-string')
const cuuid = require('cuuid')
const config = require('../lib/config')
const logger = require('../lib/logger')
const mongo = require('../lib/mongo')
const nsqWriter = require('../lib/nsqWriter')
const workerResponder = require('./workerResponder')
const RESTError = require('../lib/RESTError')
const render = require('./render')
const sitemap = require('./sitemap')

;(async() => {
  try {
    await require('../install').install()
    await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
    await nsqWriter.connect()
    workerResponder.connect()
    await main()
  } catch (e) {
    logger.error(e)
    await closeConnections()
    process.exitCode = 1
  }
})()

async function closeConnections() {
  await mongo.close()
  await nsqWriter.close()
  await workerResponder.close()
}

async function main() {
  async function getSiteConfig(host) {
    const site = await mongo.db.collection('sites').findOne({ host })

    if (site) {
      return site
    } else {
      if (config.disallowUnknownSite) {
        throw new RESTError('SITE_CONFIG_NOT_EXIST')
      } else {
        return {}
      }
    }
  }

  const app = new Koa()

  app.on('error', e => {
    // 'ERR_STREAM_DESTROYED' normally because the client closed the connection
    if (e.code === 'ERR_STREAM_DESTROYED') {
      logger.debug(e)
    } else {
      logger.error(e)
    }
  })

  app.use(async(ctx, next) => {
    try {
      await next()

      logger.info({
        method: ctx.method,
        url: ctx.href,
        status: ctx.status,
        headers: filterHeaders(ctx.headers)
      })
    } catch (e) {
      let err = e

      if (!(err instanceof RESTError)) {
        const id = cuuid()
        logger.error({ err, id })
        err = new RESTError('INTERNAL_ERROR', id)
      }

      ctx.set('Kasha-Code', err.code)
      ctx.status = err.httpStatus
      ctx.body = err.toJSON()

      logger.info({
        method: ctx.method,
        url: ctx.href,
        status: ctx.status,
        code: err.code,
        headers: filterHeaders(ctx.headers)
      })
    }

    function filterHeaders(headers) {
      const result = {}

      for (const k in headers) {
        if (k.startsWith('kasha-') || k === 'forwarded' || k.startsWith('x-forwarded-')) {
          result[k] = headers[k]
        }
      }

      return result
    }
  })

  // proxy routes
  const proxyRouter = new Router()
    .get('/sitemap.:page(\\d+).xml', sitemap.sitemap)
    .get('/sitemap.google.:page(\\d+).xml', sitemap.googleSitemap)
    .get('/sitemap.google.news.:page(\\d+).xml', sitemap.googleNewsSitemap)
    .get('/sitemap.google.image.:page(\\d+).xml', sitemap.googleImageSitemap)
    .get('/sitemap.google.video.:page(\\d+).xml', sitemap.googleVideoSitemap)
    .get('/sitemap.debug:path(/.*)', sitemap.googleSitemapItem)
    .get('/sitemap.index.:page(\\d+).xml', sitemap.sitemapIndex)
    .get('/sitemap.index.google.:page(\\d+).xml', sitemap.googleSitemapIndex)
    .get('/sitemap.index.google.news.:page(\\d+).xml', sitemap.googleNewsSitemapIndex)
    .get('/sitemap.index.google.image.:page(\\d+).xml', sitemap.googleImageSitemapIndex)
    .get('/sitemap.index.google.video.:page(\\d+).xml', sitemap.googleVideoSitemapIndex)
    .get('/robots.txt', sitemap.robotsTxt)
    .get('(.*)', (ctx, next) => {
      ctx.state.params = {
        url: ctx.state.origin + ctx.url,
        type: 'html',
        profile: ctx.headers['kasha-profile'],
        fallback: bool(ctx.headers['kasha-fallback'])
      }

      return render(ctx, next)
    })

  // api routes
  const apiRouter = new Router()

  if (config.enableDebugPage) {
    const root = path.resolve(__dirname, '../static')

    apiRouter
      .get('/', async ctx => {
        await send(ctx, 'index.html', { root })
      })
      .get('/static/(.*)', mount('/static', serve(root)))
  }

  apiRouter
    .get('/render', async(ctx, next) => {
      let url

      try {
        url = new URL(ctx.query.url)
      } catch (e) {
        throw new RESTError('INVALID_PARAM', 'url')
      }

      ctx.state.site = await getSiteConfig(url.host)
      ctx.state.origin = url.origin

      ctx.state.params = {
        url: ctx.queries.string('url'),
        type: ctx.queries.string('type', { defaults: 'json' }),
        profile: ctx.queries.string('profile'),
        noWait: ctx.queries.bool('noWait'),
        metaOnly: ctx.queries.bool('metaOnly'),
        followRedirect: ctx.queries.bool('followRedirect'),
        refresh: ctx.queries.bool('refresh'),
        fallback: ctx.queries.bool('fallback')
      }

      return render(ctx, next)
    })
    .get('*', () => {
      throw new RESTError('NOT_FOUND')
    })

  app.use(async(ctx, next) => {
    if (ctx.method === 'HEAD') {
      // health check request
      ctx.status = 200
      return
    }

    if (ctx.method !== 'GET') {
      throw new RESTError('METHOD_NOT_ALLOWED', ctx.method)
    }

    let host, protocol

    if (ctx.headers.forwarded) {
      try {
        const forwarded = parseForwardedHeader(ctx.headers.forwarded)[0]
        if (forwarded.host) {
          host = forwarded.host
        }

        if (forwarded.proto) {
          protocol = forwarded.proto
        }
      } catch (e) {
        throw new RESTError('INVALID_HEADER', 'Forwarded')
      }
    } else if (ctx.headers['x-forwarded-host']) {
      host = ctx.headers['x-forwarded-host']
    } else {
      host = ctx.host
    }

    if (!host) {
      throw new RESTError('INVALID_HOST')
    }

    if (!protocol && ctx.headers['x-forwarded-proto']) {
      protocol = ctx.headers['x-forwarded-proto']
    }

    if (protocol && !['http', 'https'].includes(protocol)) {
      throw new RESTError('INVALID_PROTOCOL')
    }

    if (config.apiHost && config.apiHost.includes(host)) {
      const matchedOrigin = ctx.path.match(/^\/(https?:\/\/[^/]+)/)

      if (!matchedOrigin) {
        return apiRouter.middleware(ctx, next)
      }

      let url

      try {
        url = new URL(matchedOrigin[1])
      } catch (e) {
        throw new RESTError('INVALID_HOST')
      }

      host = url.host
      protocol = url.protocol.slice(0, -1)
      ctx.path = ctx.path.replace(matchedOrigin[0], '')
    }

    ctx.state.site = await getSiteConfig(host)

    if (!protocol) {
      if (!ctx.state.site.defaultProtocol) {
        throw new RESTError('INVALID_PROTOCOL')
      } else {
        protocol = ctx.state.site.defaultProtocol
      }
    }

    ctx.state.origin = protocol + '://' + host
    return proxyRouter.middleware(ctx, next)
  })

  const server = stoppable(app.listen(config.port))

  // graceful exit
  let stopping = false

  async function exit() {
    if (stopping) {
      return
    }

    stopping = true
    logger.warn('Closing the server. Please wait for finishing the pending requests...')

    server.stop(async() => {
      await closeConnections()
      logger.warn('exit successfully')
    })
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)
  logger.warn(`Kasha http server started at port ${config.port}`)
}
