const config = require('../shared/config')
const logger = require('../shared/logger')
const mongo = require('../shared/mongo')
const nsqWriter = require('../shared/nsqWriter')
const nsqReader = require('../shared/nsqReader')
const Prerenderer = require('puppeteer-prerender')
const removeXMLInvalidChars = require('./removeXMLInvalidChars')

const JOB_TIMEOUT = 20 * 1000
const PRERENDER_TIMEOUT = 24 * 1000

const prerendererOpts = {
  debug: config.logLevel === 'debug' ? logger.debug.bind(logger) : false,
  timeout: PRERENDER_TIMEOUT,

  puppeteerLaunchOptions: {
    headless: global.argv.headless,

    handleSIGINT: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
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
  }
}

let db, reader, prerenderer
;(async() => {
  try {
    db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.workerOptions)
    await nsqWriter.connect()

    logger.info('Launching chromium...')
    prerenderer = new Prerenderer(prerendererOpts)
    await prerenderer.launch()
    prerenderer.on('disconnected', () => {
      logger.error('Chromium disconnected')
    })
    logger.info('Chromium launched')

    reader = nsqReader.connect(global.argv.async ? 'kasha-async-queue' : 'kasha-sync-queue', 'worker', config.nsq.reader)

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
  await nsqReader.close()

  if (prerenderer) {
    logger.info('Closing prerenderer...')
    await prerenderer.close()
    logger.info('Prerender closed')
  }
}

async function main() {
  const { URL } = require('url')
  const config = require('../shared/config')
  const RESTError = require('../shared/RESTError')
  const normalizeDoc = require('../shared/normalizeDoc')
  const userAgents = require('./userAgents')
  const uid = require('../shared/uid')
  const callback = require('../shared/callback')
  const poll = require('../shared/poll')

  /*
  snapshots schema:
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
  renderTimes: Number
  updatedAt: Date
  privateExpires: Date
  sharedExpires: Date
  lock: String
  */
  const snapshots = db.collection('snapshots')

  /*
  sitemaps schema:
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
  const sitemaps = db.collection('sitemaps')

  let jobCounter = 0

  reader.on('message', async msg => {
    jobCounter++

    const req = msg.json()
    logger.debug('receive job:', req)

    const {
      replyTo,
      correlationId,
      site,
      path,
      deviceType,
      callbackURL,
      metaOnly
    } = req

    const url = site + path

    let cacheDoc
    let { rewrites, cacheStatus } = req

    if (rewrites) {
      rewrites = rewrites.map(([type, search, replace]) => {
        if (type === 'regexp') {
          const lastSlash = search.lastIndexOf('/')
          search = new RegExp(search.slice(1, lastSlash), search.slice(lastSlash + 1))
        }

        return [search, replace]
      })
    }

    const msgTimestamp = msg.timestamp.dividedBy(1000000).integerValue().toNumber()
    const msgAttemps = msg.attempts
    const jobStartTime = Date.now()

    if (replyTo) {
      if (msgTimestamp + JOB_TIMEOUT < Date.now()) {
        logger.debug(`drop job: ${url} @${deviceType}`)
        return handleResult({ error: new RESTError('SERVER_WORKER_BUSY').toJSON() })
      }
    }

    const lock = uid()
    const lockQuery = {
      site,
      path,
      deviceType,
      lock: null
    }

    if (cacheStatus !== 'BYPASS') {
      // expired
      lockQuery.privateExpires = { $lt: new Date() }
    }

    try {
      logger.debug(`lock: ${url} @${deviceType} with ${lock}`)
      await snapshots.updateOne(lockQuery, {
        $set: {
          updatedAt: new Date(),
          lock
        },
        $setOnInsert: {
          renderTimes: 0,
          privateExpires: new Date(),
          sharedExpires: new Date(Date.now() + 30 * 1000) // set to 30 secs later, prevent from cache cleaning
        }
      }, { upsert: true })
    } catch (e) {
      // don't block the queue
      msg.finish()

      // 11000: duplicate key on upsert
      if (e.code !== 11000) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult({ error: new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId).toJSON() })
      }

      // the document maybe locked by others, or is valid
      let doc
      try {
        doc = await poll(site, path, deviceType)
      } catch (e) {
        return handleResult({ error: e.toJSON() })
      }

      return handleResult(doc)
    }

    try {
      cacheDoc = await snapshots.findOne({ site, path, deviceType, status: { $type: 'int' } })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      return handleResult({ error: new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId).toJSON() })
    }

    // render the page
    let doc

    try {
      logger.debug(`prerender ${url} @${deviceType}`)
      doc = await prerenderer.render(url, {
        userAgent: userAgents[deviceType],
        // always followRedirect when caching pages
        // in case of a request with followRedirect=true waits a cache lock of request with followRedirect=false
        followRedirect: true,
        extraMeta: {
          status: { selector: 'meta[http-equiv="Status" i]', property: 'content' },
          location: { selector: 'meta[http-equiv="Location" i]', property: 'content' },
          lastModified: { selector: 'meta[http-equiv="Last-Modified" i]', property: 'content' },
          cacheControl: { selector: 'meta[http-equiv="Cache-Control" i]', property: 'content' },
          expires: { selector: 'meta[http-equiv="Expires" i]', property: 'content' }
        },
        rewrites
      })

      logger.debug(`prerender ${url} @${deviceType} successfully`)

      if (doc.meta && doc.meta.status) {
        const s = parseInt(doc.meta.status)
        if (!isNaN(s) && s >= 100 && s < 600) {
          doc.status = s

          if ([301, 302].includes(doc.status) && doc.meta.location) {
            doc.redirect = doc.meta.location
          }
        }
      }

      if (doc.status >= 500) {
        doc.error = new RESTError('SERVER_FETCH_ERROR', url, 'HTTP ' + doc.status).toJSON()

        // discard result if cacheDoc has valid stale resource
        if (cacheDoc && cacheDoc.status < 500) {
          doc = { error: doc.error }
        }
      } else {
        doc.error = null

        if (doc.meta) {
          if (doc.meta.cacheControl) {
            let maxage = doc.meta.cacheControl.match(/max-age=(\d+)/)
            if (maxage) {
              maxage = parseInt(maxage[1])
              if (maxage >= 0) doc.privateExpires = new Date(Date.now() + maxage * 1000)
              else maxage = null
            }

            let sMaxage = doc.meta.cacheControl.match(/s-maxage=(\d+)/)
            if (sMaxage) {
              sMaxage = parseInt(sMaxage[1])
              if (sMaxage >= 0) doc.sharedExpires = new Date(Date.now() + sMaxage * 1000)
              else sMaxage = null
            }
          }

          if (!doc.privateExpires && doc.meta.expires) {
            const d = new Date(doc.meta.expires)
            if (!isNaN(d.getTime())) {
              doc.privateExpires = d
            }
          }
        }

        if (!doc.privateExpires) {
          doc.privateExpires = new Date(Date.now() + (doc.status < 400 ? config.cache.maxage : config.cache.maxStale) * 1000)
        }

        if (!doc.sharedExpires) {
          doc.sharedExpires = new Date(Date.now() + (doc.status < 400 ? config.cache.sMaxage : config.cache.maxStale) * 1000)
        }
      }
    } catch (e) {
      logger.debug(`prerender ${url} @${deviceType} failed`)
      doc = { error: new RESTError('SERVER_RENDER_ERROR', e.message).toJSON() }
    }

    doc.updatedAt = new Date()

    const query = { site, path, deviceType, lock }

    logger.debug('update snapshot:', query)
    snapshots.updateOne(query, {
      $set: {
        ...doc,
        lock: null
      },
      $inc: {
        renderTimes: 1
      }
    }, { upsert: true }).catch(e => {
      logger.error(e)
    })

    handleSitemap(doc).catch(e => {
      logger.error(e)
    })

    handleResult(doc)

    function handleSitemap(doc) {
      // sitemap
      let canonicalURL
      if (doc.meta && doc.meta.canonicalURL) {
        try {
          canonicalURL = new URL(doc.meta.canonicalURL)
        } catch (e) {
          // nop
        }
      }

      if (canonicalURL && canonicalURL.origin === site) {
        let sitemap = {}

        if (doc.openGraph) {
          if (doc.openGraph.sitemap) sitemap = doc.openGraph.sitemap

          if (sitemap.news) {
            const date = new Date(sitemap.news.publication_date)
            if (!sitemap.news.title || isNaN(date.getTime())) {
              delete sitemap.news
            } else {
              sitemap.news.title = removeXMLInvalidChars(sitemap.news.title)
              sitemap.news.publication_date = date
            }
          }

          if (!sitemap.image && doc.openGraph.og && doc.openGraph.og.image) {
            sitemap.image = []
            for (const img of doc.openGraph.og.image) {
              sitemap.image.push({
                loc: img.secure_url || img.url
              })
            }
          }
        }

        if (!sitemap.lastmod && doc.meta.lastModified) {
          const date = new Date(doc.meta.lastModified)
          if (!isNaN(date.getTime())) {
            sitemap.lastmod = date.toISOString()
          }
        }

        return sitemaps.updateOne({
          site: canonicalURL.origin,
          path: canonicalURL.pathname + canonicalURL.search
        }, {
          $set: {
            ...sitemap,
            updatedAt: new Date()
          }
        }, { upsert: true })
      } else {
        return sitemaps.deleteOne({ site, path })
      }
    }

    function handleResult(doc) {
      logger.log(`${url} @${deviceType} ${doc.error ? doc.error.code : doc.status}. queue: ${jobStartTime - msgTimestamp}ms, render: ${Date.now() - jobStartTime}ms, attemps: ${msgAttemps}`)

      if (callbackURL || replyTo) {
        // if fetch the document failed, we try to use the cached document if mode is not BYPASS
        if (cacheStatus !== 'BYPASS' && cacheDoc && (!doc.status || doc.status >= 500 && cacheDoc.status < 500)) {
          doc = cacheDoc
          if (cacheStatus === 'EXPIRED') {
            cacheStatus = 'STALE'
          }
        }

        let error = null
        if (doc.status) {
          doc = normalizeDoc(doc, metaOnly)
        } else {
          error = doc.error
        }

        if (callbackURL) {
          callback(callbackURL, error, doc, cacheStatus)
        } else if (replyTo) {
          nsqWriter.writer.publish(replyTo, {
            correlationId,
            error,
            doc,
            cacheStatus
          })
        }
      }

      if (!msg.hasResponded) msg.finish()
      jobCounter--
    }
  })

  // graceful exit
  let stopping = false
  async function exit() {
    if (stopping) return

    stopping = true
    logger.info('Closing the worker... Please wait for finishing the in-flight jobs...')
    reader.pause()

    const interval = setInterval(async() => {
      if (jobCounter === 0) {
        clearInterval(interval)
        await closeConnections()
        logger.info('exit successfully')
      }
    }, 1000)
  }

  process.once('SIGINT', exit)
  process.once('SIGTERM', exit)

  logger.info('Kasha Worker started')
}
