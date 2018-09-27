(async() => {
  await require('../install')

  const config = require('../shared/config')
  const RESTError = require('../shared/RESTError')
  const logger = require('../shared/logger')

  const mongo = require('../shared/mongo')
  const db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)

  const nsqWriter = await require('../shared/nsqWriter').connect()
  const workerResponse = require('./workerResponse')

  const Koa = require('koa')
  const Router = require('koa-router')
  const stoppable = require('stoppable')

  const app = new Koa()
  const proxy = require('./proxy')
  const render = require('./render')
  const sitemap = require('./sitemap')

  app.on('error', e => {
    logger.error(e)
  })

  app.use(async(ctx, next) => {
    try {
      logger.debug(`${ctx.method} ${ctx.url}`)
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
    }
  })

  // proxy routes
  const proxyRouter = new Router()
  proxyRouter.get(`/sitemaps/:page.xml`, sitemap.sitemap)
  proxyRouter.get(`/sitemaps/google/:page.xml`, sitemap.googleSitemap)
  proxyRouter.get(`/sitemaps/google/news/:page.xml`, sitemap.googleNewsSitemap)
  proxyRouter.get(`/sitemaps/google/image/:page.xml`, sitemap.googleImageSitemap)
  proxyRouter.get(`/sitemaps/google/video/:page.xml`, sitemap.googleVideoSitemap)
  proxyRouter.get(`/sitemaps/index/:page.xml`, sitemap.sitemapIndex)
  proxyRouter.get(`/sitemaps/index/google/:page.xml`, sitemap.googleSitemapIndex)
  proxyRouter.get(`/sitemaps/index/google/news/:page.xml`, sitemap.googleNewsSitemapIndex)
  proxyRouter.get(`/sitemaps/index/google/image/:page.xml`, sitemap.googleImageSitemapIndex)
  proxyRouter.get(`/sitemaps/index/google/video/:page.xml`, sitemap.googleVideoSitemapIndex)
  proxyRouter.get(`/robots.txt`, sitemap.robotsTxt)

  const proxyRoutes = proxyRouter.routes()

  // api routes
  const apiRouter = new Router()

  apiRouter.get('/render', render)

  apiRouter.get('/cache', (ctx, next) => {
    ctx.query.noWait = ''
    return next()
  }, render)

  const siteRegex = ':site(https?://[^/]+)'
  apiRouter.get(`/${siteRegex}/sitemaps/:page.xml`, sitemap.sitemap)
  apiRouter.get(`/${siteRegex}/sitemaps/google/:page.xml`, sitemap.googleSitemap)
  apiRouter.get(`/${siteRegex}/sitemaps/google/news/:page.xml`, sitemap.googleNewsSitemap)
  apiRouter.get(`/${siteRegex}/sitemaps/google/image/:page.xml`, sitemap.googleImageSitemap)
  apiRouter.get(`/${siteRegex}/sitemaps/google/video/:page.xml`, sitemap.googleVideoSitemap)
  apiRouter.get(`/${siteRegex}/sitemaps/index/:page.xml`, sitemap.sitemapIndex)
  apiRouter.get(`/${siteRegex}/sitemaps/index/google/:page.xml`, sitemap.googleSitemapIndex)
  apiRouter.get(`/${siteRegex}/sitemaps/index/google/news/:page.xml`, sitemap.googleNewsSitemapIndex)
  apiRouter.get(`/${siteRegex}/sitemaps/index/google/image/:page.xml`, sitemap.googleImageSitemapIndex)
  apiRouter.get(`/${siteRegex}/sitemaps/index/google/video/:page.xml`, sitemap.googleVideoSitemapIndex)
  apiRouter.get(`/${siteRegex}/robots.txt`, sitemap.robotsTxt)

  apiRouter.get('/(http.+)', (ctx, next) => {
    ctx.query = {
      url: ctx.url.slice(1),
      deviceType: ctx.headers['x-device-type'] || 'desktop'
    }
    ctx.path = '/'
    return next()
  }, render)

  const apiRoutes = apiRouter.routes()

  app.use(async(ctx, next) => {
    if (ctx.method !== 'GET') throw new RESTError('CLIENT_METHOD_NOT_ALLOWED', ctx.method)

    const host = ctx.host
    if (host) {
      const site = await db.collection('sites').findOne({ host })
      if (site) ctx.site = site
    }

    if (ctx.site) {
      proxyRoutes(ctx, next)
    } else {
      apiRoutes(ctx, next)
    }
  })

  const server = stoppable(app.listen(config.port))

  // graceful exit
  let stopping = false
  process.on('SIGINT', async() => {
    if (stopping) return

    stopping = true
    logger.info('Closing the server. Please wait for finishing the pending requests.')

    server.stop(async() => {
      clearInterval(workerResponse.interval)
      workerResponse.reader.close()
      nsqWriter.close()
      await mongo.close()
    })
  })

  logger.info(`http server started at port ${config.port}`)
})()
