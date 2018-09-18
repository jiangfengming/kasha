(async function() {
  const { URL } = require('url')
  const RESTError = require('../shared/RESTError')
  const logger = require('../shared/logger')
  const config = require('../shared/config')

  const mongo = require('../shared/mongo')
  const db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.workerOptions)

  const collection = db.collection('snapshots')
  /*
  schema:
  site: String
  path: String
  deviceType: String
  status: Number
  redirect: String
  meta: Object
  openGraph: Object
  links: Array
  html: String
  staticHTML: String
  error: String
  times: Number
  updatedAt: Date
  privateExpires: Date
  sharedExpires: Date
  lock: String
  */

  const sitemaps = db.collection('sitemaps')
  /*
  schema:
  site: String
  path: String
  lastmod: String
  changefreq: String
  priority: String
  news: Array
  images: Array
  videos: Array
  updatedAt: Date
  */

  const Prerenderer = require('puppeteer-prerender')

  const prerendererOpts = {
    timeout: 24 * 1000,
    puppeteerLaunchOptions: {
      handleSIGINT: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    },
    parseOpenGraphOptions: {
      // these tag has attributes
      alias: {
        'sitemap:video:player_loc': 'sitemap:video:player_loc:_',
        'sitemap:video:restriction': 'sitemap:video:restriction:_',
        'sitemap:video:platform': 'sitemap:video:platform:_',
        'sitemap:video:price': 'sitemap:video:price:_',
        'sitemap:video:uploader': 'sitemap:video:uploader:_'
      },

      arrays: [
        'sitemap:image',
        'sitemap:video',
        'sitemap:video:tag'
      ]
    },
    appendSearchParams: {
      _no_prerender: '1'
    }
  }

  if (config.loglevel === 'debug') {
    prerendererOpts.debug = true
    prerendererOpts.puppeteerLaunchOptions.headless = false
  }

  const prerenderer = new Prerenderer(prerendererOpts)

  const userAgents = require('./userAgents')

  const uid = require('../shared/uid')
  const callback = require('../shared/callback')

  const argv = require('yargs').argv
  const { Reader } = require('nsqjs')
  const topic = argv.async ? 'kasha-async-queue' : 'kasha-sync-queue'
  const reader = new Reader(topic, 'worker', config.nsq.reader)
  reader.connect()

  const nsqWriter = await require('../shared/nsqWriter').connect()
  const poll = require('../shared/poll')

  const TIMEOUT = 27 * 1000

  let jobCounter = 0

  reader.on('message', async msg => {
    jobCounter++

    const now = new Date()
    const req = msg.json()
    logger.debug('receive job:', req)

    const {
      replyTo,
      correlationId,
      site,
      path,
      deviceType,
      callbackURL,
      metaOnly,
      cache
    } = req

    const url = site + path

    if (replyTo) {
      const time = msg.timestamp.dividedBy(1000000).integerValue().toNumber()
      logger.debug(time)
      if (time + TIMEOUT < now.getTime()) {
        logger.debug('drop job:', req)
        return handleResult(new RESTError('SERVER_WORKER_BUSY'))
      }
    }

    let status, redirect, meta, openGraph, links, html, staticHTML, error, privateExpires, sharedExpires
    let updatedAt = now

    // lock
    const lock = uid()

    const lockQuery = {
      site,
      path,
      deviceType,
      lock: false,
      privateExpires: { $lt: now } // expired
    }

    try {
      await collection.updateOne(lockQuery, {
        $set: {
          updatedAt,
          lock
        },
        $setOnInsert: {
          times: 0
        }
      }, { upsert: true })
    } catch (e) {
      // don't block the queue
      msg.finish()

      // 11000: duplicate key on upsert
      if (e.code !== 11000) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      // the document maybe locked by others, or is valid
      let doc
      try {
        doc = await poll(site, path, deviceType)
      } catch (e) {
        return handleResult(e)
      }

      if (error) {
        return handleResult(new RESTError(error))
      }

      return handleResult(null, {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        links,
        html: metaOnly ? undefined : html,
        staticHTML: metaOnly ? undefined : staticHTML,
        privateExpires,
        sharedExpires,
        updatedAt
      })
    }

    // render the page
    try {
      ({ status, redirect, meta, openGraph, links, html, staticHTML } = await prerenderer.render(url, {
        userAgent: userAgents[deviceType],
        // always followRedirect when caching pages
        // in case of a request with followRedirect=true waits a cache lock of request with followRedirect=false
        followRedirect: true,
        extraMeta: {
          status: { selector: 'meta[http-equiv="Status" i]', property: 'content' },
          lastModified: { selector: 'meta[http-equiv="Last-Modified" i]', property: 'content' },
          cacheControl: { selector: 'meta[http-equiv="Cache-Control" i]', property: 'content' },
          expires: { selector: 'meta[http-equiv="Expires" i]', property: 'content' }
        }
      }))

      if (meta) {
        if (meta.status) {
          const s = parseInt(meta.status)
          if (!isNaN(s) && s >= 100 && s < 600) {
            status = s
          }
        }

        if (meta.cacheControl) {
          let maxage = meta.cacheControl.match(/max-age=(\d+)/)
          if (maxage) {
            maxage = parseInt(maxage[1])
            if (maxage >= 0) privateExpires = new Date(now.getTime() + maxage * 1000)
            else maxage = null
          }

          let sMaxage = meta.cacheControl.match(/s-maxage=(\d+)/)
          if (sMaxage) {
            sMaxage = parseInt(sMaxage[1])
            if (sMaxage >= 0) sharedExpires = new Date(now.getTime() + sMaxage * 1000)
            else sMaxage = null
          }
        }

        if (!privateExpires && meta.expires) {
          const d = new Date(meta.expires)
          if (!isNaN(d.getTime())) {
            privateExpires = d
          }
        }
      }

      if (!privateExpires) {
        privateExpires = new Date(now.getTime() + config.cache.maxage * 1000)
      }

      if (!sharedExpires) {
        sharedExpires = new Date(now.getTime() + config.cache.sMaxage * 1000)
      }
    } catch (e) {
      error = new RESTError('SERVER_RENDER_ERROR', e.message)
    }

    if (error) {
      try {
        await collection.updateOne({ site, path, deviceType, lock }, {
          $set: {
            error: error.toJSON(),
            updatedAt,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })

        return handleResult(error)
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }
    } else {
      try {
        await collection.updateOne({ site, path, deviceType }, {
          $set: {
            status,
            redirect,
            meta,
            openGraph,
            links,
            html,
            staticHTML,
            error: null,
            updatedAt,
            privateExpires,
            sharedExpires,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })

        // sitemap
        let canonicalURL
        const currentURL = new URL(url)

        if (meta && meta.canonicalURL) {
          try {
            canonicalURL = new URL(meta.canonicalURL)
          } catch (e) {
            // nop
          }
        }

        if (canonicalURL && canonicalURL.origin === currentURL.origin) {
          let sitemap = {}

          if (openGraph) {
            if (openGraph.sitemap) sitemap = openGraph.sitemap

            if (sitemap.news) {
              const date = new Date(sitemap.news.publication_date)
              if (isNaN(date.getTime())) {
                delete sitemap.news
              } else {
                sitemap.news.publication_date = date
              }
            }

            if (!sitemap.image && openGraph.og && openGraph.og.image) {
              sitemap.image = []
              for (const img of openGraph.og.image) {
                sitemap.image.push({
                  loc: img.secure_url || img.url
                })
              }
            }
          }

          if (!sitemap.lastmod && meta.lastModified) {
            const date = new Date(meta.lastModified)
            if (!isNaN(date.getTime())) {
              sitemap.lastmod = date.toISOString()
            }
          }

          await sitemaps.updateOne({
            site: canonicalURL.origin,
            path: canonicalURL.pathname + canonicalURL.search
          }, {
            $set: {
              ...sitemap,
              updatedAt
            }
          }, { upsert: true })
        } else {
          await sitemaps.deleteOne({
            site: currentURL.origin,
            path: currentURL.pathname + currentURL.search
          })
        }
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      return handleResult(null, {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        links,
        html: metaOnly ? undefined : html,
        staticHTML: metaOnly ? undefined : staticHTML,
        privateExpires,
        sharedExpires,
        updatedAt
      })
    }

    function handleResult(error, result) {
      if (callbackURL) {
        callback(callbackURL, error, result || cache)
      } else if (replyTo) {
        nsqWriter.publish(replyTo, {
          correlationId,
          error,
          result: result || cache
        })
      }

      if (!msg.hasResponded) msg.finish()

      logger.debug(`job finished: ${url}`)
      jobCounter--
    }
  })

  // graceful exit
  let stopping = false

  process.once('SIGINT', async() => {
    if (stopping) return

    stopping = true
    logger.info('Closing the worker... Please wait for finishing the in-flight jobs.')
    reader.pause()

    const interval = setInterval(() => {
      if (jobCounter === 0) {
        clearInterval(interval)
        exit()
      }
    }, 1000)

    async function exit() {
      reader.close()
      nsqWriter.close()
      await prerenderer.close()
      await mongo.close()
    }
  })

  logger.info('Worker started')
}())
