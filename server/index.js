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
  const getHostConfig = require('../shared/getHostConfig')
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
        err = new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }
      ctx.set('Kasha-Code', err.code)
      ctx.status = err.httpStatus
      ctx.body = err.toJSON()
      logger.log(`${ctx.method} ${ctx.href} ${ctx.status}: ${err.code}`)
    }
  })

  // proxy routes
  const proxyRoutes = new Router()
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
        type: 'html'
      }
      return render(ctx, next)
    })
    .routes()

  // api routes
  const apiRouter = new Router()

  if (config.enableHomepage) {
    apiRouter.get('/', async ctx => {
      await send(ctx, 'index.html', { root: path.resolve(__dirname, '../static') })
    })

    apiRouter.get('/static/*', mount('/static', serve(path.resolve(__dirname, '../static'))))
  }

  const apiRoutes = apiRouter
    .get('/render', (ctx, next) => {
      ctx.state.params = { ...ctx.query }
      return render(ctx, next)
    })
    .get('*', () => {
      throw new RESTError('CLIENT_NO_SUCH_API')
    })
    .routes()

  app.use(async(ctx, next) => {
    if (ctx.method === 'HEAD') {
      // health check request
      ctx.status = 200
      return
    }

    if (ctx.method !== 'GET') {
      throw new RESTError('CLIENT_METHOD_NOT_ALLOWED', ctx.method)
    }

    let host = ctx.host
    let protocol

    if (host && config.apiHost && config.apiHost.includes(host)) {
      const matchedOrigin = ctx.path.match(/^\/(https?:\/\/[^/]+)/)
      if (!matchedOrigin) {
        return apiRoutes(ctx, next)
      }

      let url
      try {
        url = new URL(matchedOrigin[1])
      } catch (e) {
        throw new RESTError('CLIENT_INVALID_HOST')
      }

      host = url.host
      protocol = url.protocol
      ctx.path = ctx.path.replace(matchedOrigin[0], '')
    } else {
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
          throw new RESTError('CLIENT_INVALID_HEADER', 'Forwarded')
        }
      } else if (ctx.headers['x-forwarded-host']) {
        host = ctx.headers['x-forwarded-host']
      }

      if (!protocol && ctx.headers['x-forwarded-proto']) {
        protocol = ctx.headers['x-forwarded-proto']
      }

      if (protocol && !['http', 'https'].includes(protocol)) {
        throw new RESTError('CLIENT_INVALID_PROTOCOL')
      }

      if (!host) {
        throw new RESTError('CLIENT_INVALID_HOST')
      }
    }

    ctx.state.config = await getHostConfig(host)

    if (!ctx.state.config && config.disallowUnknownHost) {
      throw new RESTError('CLIENT_HOST_CONFIG_NOT_EXIST')
    }

    if (!protocol) {
      if (!ctx.state.config || ctx.state.config.defaultProtocol) {
        throw new RESTError('CLIENT_INVALID_PROTOCOL')
      }

      protocol = ctx.state.config.defaultProtocol
    }

    ctx.state.origin = protocol + '://' + ctx.state.config.host
    return proxyRoutes(ctx, next)
  })

  const server = stoppable(app.listen(config.port))

  // graceful exit
  let stopping = false
  async function exit() {
    if (stopping) return

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
