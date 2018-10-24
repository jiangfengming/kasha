(async() => {
  const argv = require('yargs').argv
  const logger = require('../shared/logger')

  logger.debug(argv)

  await require('../install')

  const config = require('../shared/config')
  const RESTError = require('../shared/RESTError')

  const mongo = require('../shared/mongo')
  const db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)

  const nsqWriter = await require('../shared/nsqWriter').connect()
  const workerResponse = require('./workerResponse')

  const Koa = require('koa')
  const Router = require('koa-router')
  const stoppable = require('stoppable')

  const app = new Koa()
  const render = require('./render')
  const sitemap = require('./sitemap')

  app.on('error', e => {
    logger.error(e)
  })

  app.use(async(ctx, next) => {
    try {
      logger.debug(`${ctx.method} ${ctx.href}`)
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
        url: ctx.siteConfig.protocol + '//' + ctx.siteConfig.host + ctx.url,
        deviceType: ctx.siteConfig.deviceType || 'desktop'
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
        ctx.siteConfig = await db.collection('sites').findOne({ host: url.host })
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
        deviceType: ctx.headers['x-device-type'] || 'desktop'
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

    const host = ctx.host

    if (!host) throw new RESTError('CLIENT_EMPTY_HOST_HEADER')

    if (config.apiHost && config.apiHost.includes(host)) {
      ctx.mode = 'api'
      return apiRoutes(ctx, next)
    } else {
      ctx.mode = 'proxy'
      ctx.siteConfig = await db.collection('sites').findOne({ host })
      if (!ctx.siteConfig) throw new RESTError('CLIENT_HOST_CONFIG_NOT_EXIST')
      ctx.site = ctx.siteConfig.protocol + '//' + ctx.siteConfig.host
      return proxyRoutes(ctx, next)
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
