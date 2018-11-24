const config = require('../shared/config')
const logger = require('../shared/logger')
const mongo = require('../shared/mongo')
const nsqWriter = require('../shared/nsqWriter')
const workerResponder = require('./workerResponder')

;(async() => {
  try {
    await require('../install')

    logger.info('connecting to MongoDB...')
    await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
    logger.info('MongoDB connected')

    logger.info('connecting to NSQ writer...')
    await nsqWriter.connect()
    logger.info('NSQ writer connected')

    workerResponder.connect()

    await main()
  } catch (e) {
    logger.error(e)
    await exit()
    process.exitCode = 1
  }
})()

async function exit() {
  logger.info('Closing MongoDB connection...')
  await mongo.close()
  logger.info('MongoDB connection closed.')

  logger.info('Closing NSQ writer connection...')
  await nsqWriter.close()
  logger.info('NSQ writer connection closed.')

  logger.info('Closing worker responder connection...')
  await workerResponder.close()
  logger.info('Worker responder connection closed.')
}

async function main() {
  const RESTError = require('../shared/RESTError')
  const getSiteConfig = require('../shared/getSiteConfig')
  const Koa = require('koa')
  const Router = require('koa-router')
  const render = require('./render')
  const sitemap = require('./sitemap')
  const stoppable = require('stoppable')
  const parseForwardedHeader = require('forwarded-parse')

  const app = new Koa()

  app.on('error', e => {
    logger.error(e)
  })

  app.use(async(ctx, next) => {
    try {
      logger.debug(ctx.method, ctx.href)
      await next()
      logger.log(`${ctx.method} ${ctx.href} ${ctx.status}`)
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
    .get('/sitemaps/:page.xml', sitemap.sitemap)
    .get('/sitemaps/google/:page.xml', sitemap.googleSitemap)
    .get('/sitemaps/google/news/:page.xml', sitemap.googleNewsSitemap)
    .get('/sitemaps/google/image/:page.xml', sitemap.googleImageSitemap)
    .get('/sitemaps/google/video/:page.xml', sitemap.googleVideoSitemap)
    .get('/sitemaps/index/:page.xml', sitemap.sitemapIndex)
    .get('/sitemaps/index/google/:page.xml', sitemap.googleSitemapIndex)
    .get('/sitemaps/index/google/news/:page.xml', sitemap.googleNewsSitemapIndex)
    .get('/sitemaps/index/google/image/:page.xml', sitemap.googleImageSitemapIndex)
    .get('/sitemaps/index/google/video/:page.xml', sitemap.googleVideoSitemapIndex)
    .get('/robots.txt', sitemap.robotsTxt)
    .get('(.*)', ctx => {
      ctx.query = {
        url: ctx.siteConfig.protocol + '://' + ctx.siteConfig.host + ctx.url,
        deviceType: ctx.siteConfig.deviceType || 'desktop',
        type: 'html'
      }
      ctx.path = '/render'
      return render(ctx)
    })
    .routes()


  // api routes
  const siteParam = ':site(https?://[^/]+)'
  const apiRoutes = new Router()
    .param('site', async(site, ctx, next) => {
      try {
        const url = new URL(site)
        ctx.site = url.origin
        ctx.siteConfig = await getSiteConfig(url.host)
        return next()
      } catch (e) {
        throw new RESTError('CLIENT_INVALID_PARAM', 'site')
      }
    })
    .get(`/${siteParam}/sitemaps/:page.xml`, sitemap.sitemap)
    .get(`/${siteParam}/sitemaps/google/:page.xml`, sitemap.googleSitemap)
    .get(`/${siteParam}/sitemaps/google/news/:page.xml`, sitemap.googleNewsSitemap)
    .get(`/${siteParam}/sitemaps/google/image/:page.xml`, sitemap.googleImageSitemap)
    .get(`/${siteParam}/sitemaps/google/video/:page.xml`, sitemap.googleVideoSitemap)
    .get(`/${siteParam}/sitemaps/index/:page.xml`, sitemap.sitemapIndex)
    .get(`/${siteParam}/sitemaps/index/google/:page.xml`, sitemap.googleSitemapIndex)
    .get(`/${siteParam}/sitemaps/index/google/news/:page.xml`, sitemap.googleNewsSitemapIndex)
    .get(`/${siteParam}/sitemaps/index/google/image/:page.xml`, sitemap.googleImageSitemapIndex)
    .get(`/${siteParam}/sitemaps/index/google/video/:page.xml`, sitemap.googleVideoSitemapIndex)
    .get(`/${siteParam}/robots.txt`, sitemap.robotsTxt)
    .get('/render', render)
    .get('/cache', (ctx, next) => {
      ctx.query.noWait = ''
      return next()
    }, render)
    .get('/(http.+)', (ctx, next) => {
      ctx.query = {
        url: ctx.url.slice(1),
        deviceType: ctx.headers['x-device-type'] || 'desktop',
        type: 'static'
      }
      ctx.path = '/render'
      return next()
    }, render)
    .get('(.*)', () => {
      throw new RESTError('CLIENT_NO_SUCH_API')
    })
    .routes()

  app.use(async(ctx, next) => {
    if (ctx.method === 'HEAD') {
      // health check request
      ctx.body = ''
      return
    } else if (ctx.method !== 'GET') {
      throw new RESTError('CLIENT_METHOD_NOT_ALLOWED', ctx.method)
    }

    let host = ctx.host
    if (!host) throw new RESTError('CLIENT_EMPTY_HOST_HEADER')

    if (config.apiHost && config.apiHost.includes(host)) {
      ctx.mode = 'api'
      return apiRoutes(ctx, next)
    } else {
      ctx.mode = 'proxy'

      let protocol
      if (ctx.headers.forwarded) {
        try {
          const forwarded = parseForwardedHeader(ctx.headers.forwarded)[0]
          if (forwarded.host) host = forwarded.host
          if (forwarded.proto) protocol = forwarded.proto
        } catch (e) {
          throw new RESTError('CLIENT_INVALID_HEADER', 'Forwarded')
        }
      } else if (ctx.headers['x-forwarded-host']) {
        host = ctx.headers['x-forwarded-host']
      }

      if (!protocol && ctx.headers['x-forwarded-proto']) {
        protocol = ctx.headers['x-forwarded-proto']
      }

      const query = { host }
      if (protocol) {
        query.protocol = protocol
      }

      ctx.siteConfig = await getSiteConfig(query)

      if (!ctx.siteConfig) {
        throw new RESTError('CLIENT_HOST_CONFIG_NOT_EXIST')
      }

      ctx.site = ctx.siteConfig.protocol + '://' + ctx.siteConfig.host
      return proxyRoutes(ctx, next)
    }
  })

  const server = stoppable(app.listen(config.port))

  // graceful exit
  let stopping = false
  process.on('SIGINT', async() => {
    if (stopping) return

    stopping = true
    logger.info('Closing the server. Please wait for finishing the pending requests...')

    server.stop(async() => {
      await exit()
      logger.info('exit successfully')
    })
  })

  logger.info(`Kasha http server started at port ${config.port}`)
}
