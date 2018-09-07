(async() => {
  await require('../install')

  const config = require('../shared/config')
  const RESTError = require('../shared/RESTError')
  const logger = require('../shared/logger')

  const mongo = require('../shared/mongo')
  await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)

  const nsqWriter = await require('../shared/nsqWriter').connect()
  const workerResponse = require('./workerResponse')

  const Koa = require('koa')
  const Router = require('koa-router')
  const stoppable = require('stoppable')

  const app = new Koa()
  const router = new Router()
  const render = require('./render')
  const sitemap = require('./sitemap')

  app.on('error', e => {
    logger.error(e)
  })

  app.use(async(ctx, next) => {
    try {
      logger.debug(`${ctx.method} ${ctx.url}`)
      await next()
      ctx.set('Kasha-Code', 'OK')
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

  // routes
  router.get('/render', render)

  router.get('/cache', (ctx, next) => {
    ctx.query.noWait = ''
    return next()
  }, render)

  const siteRegex = ':site(https?://[^/]+)'
  router.get(`/${siteRegex}/sitemaps/:page.xml`, sitemap.sitemap)
  router.get(`/${siteRegex}/sitemaps/google/:page.xml`, sitemap.googleSitemap)
  router.get(`/${siteRegex}/sitemaps/google/news/:page.xml`, sitemap.googleNewsSitemap)
  router.get(`/${siteRegex}/sitemaps/google/image/:page.xml`, sitemap.googleImageSitemap)
  router.get(`/${siteRegex}/sitemaps/google/video/:page.xml`, sitemap.googleVideoSitemap)
  router.get(`/${siteRegex}/sitemaps/index/:page.xml`, sitemap.sitemapIndex)
  router.get(`/${siteRegex}/sitemaps/index/google/:page.xml`, sitemap.googleSitemapIndex)
  router.get(`/${siteRegex}/sitemaps/index/google/news/:page.xml`, sitemap.googleNewsSitemapIndex)
  router.get(`/${siteRegex}/sitemaps/index/google/image/:page.xml`, sitemap.googleImageSitemapIndex)
  router.get(`/${siteRegex}/sitemaps/index/google/video/:page.xml`, sitemap.googleVideoSitemapIndex)
  router.get(`/${siteRegex}/robots.txt`, sitemap.robotsTxt)

  router.get('/(http.+)', (ctx, next) => {
    ctx.query = {
      url: ctx.url.slice(1),
      deviceType: ctx.headers['x-device-type'] || 'desktop'
    }
    ctx.path = '/'
    return next()
  }, render)

  app.use(router.routes())

  app.use(() => {
    throw new RESTError('CLIENT_NO_SUCH_API')
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
