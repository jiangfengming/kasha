const config = require('../shared/config')
const logger = require('../shared/logger')
const mongo = require('../shared/mongo')
const nsqWriter = require('../shared/nsqWriter')
const workerResponder = require('./workerResponder')

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
  const RESTError = require('../shared/RESTError')
  const getSiteConfig = require('./getSiteConfig')
  const Koa = require('koa')
  const Router = require('koa-pilot')
  const mount = require('koa-mount')
  const serve = require('koa-static')
  const send = require('koa-send')
  const path = require('path')
  const render = require('./render')
  const sitemap = require('./sitemap')
  const stoppable = require('stoppable')
  const parseForwardedHeader = require('forwarded-parse')

  async function _getSiteConfig(ctx, host) {
    ctx.state.config = await getSiteConfig(host)

    if (!ctx.state.config) {
      if (config.disallowUnknownHost) {
        throw new RESTError('HOST_CONFIG_NOT_EXIST')
      } else {
        ctx.state.config = {}
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
    } catch (e) {
      let err = e
      if (!(e instanceof RESTError)) {
        const { timestamp, eventId } = logger.error(e)
        err = new RESTError('INTERNAL_ERROR', timestamp, eventId)
      }
      ctx.set('Kasha-Code', err.code)
      ctx.status = err.httpStatus
      ctx.body = err.toJSON()
      logger.log(`${ctx.method} ${ctx.href} ${ctx.status}: ${err.code}`)
    }
  })

  // proxy routes
  const proxyRouter = new Router()
    .get(/^\/sitemap\.(?<page>\d+)\.xml$/, sitemap.sitemap)
    .get(/^\/sitemap\.google\.(?<page>\d+)\.xml$/, sitemap.googleSitemap)
    .get(/^\/sitemap\.google\.news\.(?<page>\d+)\.xml$/, sitemap.googleNewsSitemap)
    .get(/^\/sitemap\.google\.image\.(?<page>\d+)\.xml$/, sitemap.googleImageSitemap)
    .get(/^\/sitemap\.google\.video\.(?<page>\d+)\.xml$/, sitemap.googleVideoSitemap)
    .get(/^\/sitemap\.debug(?<path>\/.*)/, sitemap.googleSitemapItem)
    .get(/^\/sitemap\.index\.(?<page>\d+)\.xml$/, sitemap.sitemapIndex)
    .get(/^\/sitemap\.index\.google\.(?<page>\d+)\.xml$/, sitemap.googleSitemapIndex)
    .get(/^\/sitemap\.index\.google\.news\.(?<page>\d+)\.xml$/, sitemap.googleNewsSitemapIndex)
    .get(/^\/sitemap\.index\.google\.image\.(?<page>\d+)\.xml$/, sitemap.googleImageSitemapIndex)
    .get(/^\/sitemap\.index\.google\.video\.(?<page>\d+)\.xml$/, sitemap.googleVideoSitemapIndex)
    .get('/robots.txt', sitemap.robotsTxt)
    .get('*', (ctx, next) => {
      ctx.state.params = {
        url: ctx.state.origin + ctx.url,
        type: 'html',
        profile: ctx.headers['kasha-profile']
      }
      return render(ctx, next)
    })

  // api routes
  const apiRouter = new Router()

  if (config.enableHomepage) {
    const root = path.resolve(__dirname, '../static')

    apiRouter
      .get('/', async ctx => {
        await send(ctx, 'index.html', { root })
      })
      .get('/favicon.ico', async ctx => {
        await send(ctx, 'favicon.png', { root })
      })
      .get('/static/*', mount('/static', serve(root)))
  }

  apiRouter
    .get('/render', async(ctx, next) => {
      let url
      try {
        url = new URL(ctx.query.url)
      } catch (e) {
        throw new RESTError('INVALID_PARAM', 'url')
      }

      await _getSiteConfig(ctx, url.host)
      ctx.state.origin = url.origin
      ctx.state.params = ctx.query
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
        return apiRouter.routes(ctx, next)
      }

      let url
      try {
        url = new URL(matchedOrigin[1])
      } catch (e) {
        throw new RESTError('INVALID_HOST')
      }

      host = url.host
      protocol = url.protocol
      ctx.path = ctx.path.replace(matchedOrigin[0], '')
    }

    await _getSiteConfig(ctx, host)

    if (!protocol) {
      if (!ctx.state.config.defaultProtocol) {
        throw new RESTError('INVALID_PROTOCOL')
      } else {
        protocol = ctx.state.config.defaultProtocol
      }
    }

    ctx.state.origin = protocol + '://' + host
    return proxyRouter.routes(ctx, next)
  })

  const server = stoppable(app.listen(config.port))

  // graceful exit
  let stopping = false
  async function exit() {
    if (stopping) {
      return
    }

    stopping = true
    logger.info('Closing the server. Please wait for finishing the pending requests...')

    server.stop(async() => {
      await closeConnections()
      logger.info('exit successfully')
    })
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)

  logger.info(`Kasha http server started at port ${config.port}`)
}
