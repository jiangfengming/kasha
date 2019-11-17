const config = require('../lib/config')
const logger = require('../lib/logger')
const mongo = require('../lib/mongo')
const nsqWriter = require('../lib/nsqWriter')
const nsqReader = require('../lib/nsqReader')
const RESTError = require('../lib/RESTError')
const normalizeDoc = require('../lib/normalizeDoc')
const uid = require('../lib/uid')
const callback = require('../lib/callback')
const poll = require('../lib/poll')
const prerenderer = require('./prerenderer')
const updateSitemap = require('./updateSitemap')
const validHTTPStatus = require('../lib/validHTTPStatus')

const JOB_TIMEOUT = 15 * 1000

let reader, jobCounter = 0, stopping = false

;(async() => {
  try {
    await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.workerOptions)
    await nsqWriter.connect()

    logger.info('Launching chromium...')
    await prerenderer.launch()

    prerenderer.on('disconnected', () => {
      logger.error('Chromium disconnected')
    })

    logger.info('Chromium launched')

    reader = nsqReader.connect(global.argv.async ? 'kasha-async-queue' : 'kasha-sync-queue', 'worker', config.nsq.reader)

    main()

    process.once('SIGINT', exit)
    process.once('SIGTERM', exit)

    logger.info('Kasha Worker started')
  } catch (e) {
    logger.error(e)
    await closeConnections()
    process.exitCode = 1
  }
})()

// graceful exit
async function exit() {
  if (stopping) {
    return
  }

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

function main() {
  /*
  snapshots schema:
  site: String
  path: String
  profile: String
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
  removeAt: Date
  lock: String
  */
  const snapshots = mongo.db.collection('snapshots')

  reader.on('message', async msg => {
    jobCounter++
    const req = msg.json()
    logger.debug('receive job:', req)

    const {
      replyTo,
      correlationId,
      site,
      path,
      profile,
      userAgent,
      callbackURL,
      metaOnly,
      rewrites
    } = req

    const url = site + path
    let { cacheStatus } = req
    const msgTimestamp = msg.timestamp.dividedBy(1000000).integerValue().toNumber()
    const msgAttemps = msg.attempts
    const jobStartTime = Date.now()

    if (replyTo) {
      if (msgTimestamp + JOB_TIMEOUT < Date.now()) {
        logger.debug(`drop job: ${url} @${profile}`)
        return handleResult({ error: new RESTError('WORKER_BUSY').toJSON() })
      }
    }

    const lock = uid()

    const lockQuery = {
      site,
      path,
      profile,
      lock: null
    }

    if (cacheStatus !== 'BYPASS') {
      // expired
      lockQuery.privateExpires = { $lt: new Date() }
    }

    try {
      logger.debug(`lock: ${url} @${profile} with ${lock}`)

      await snapshots.updateOne(lockQuery, {
        $set: {
          updatedAt: new Date(),
          lock
        },

        $setOnInsert: {
          renderTimes: 0,
          privateExpires: new Date(),
          sharedExpires: new Date(),
          removeAt: new Date(Date.now() + 30 * 1000) // set to 30 secs later, prevent from cache cleaning
        }
      }, { upsert: true })
    } catch (e) {
      // don't block the queue
      msg.finish()

      // 11000: duplicate key on upsert
      if (e.code !== 11000) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult({ error: new RESTError('INTERNAL_ERROR', timestamp, eventId).toJSON() })
      }

      // the document maybe locked by others, or is valid
      let doc

      try {
        doc = await poll(site, path, profile)
      } catch (e) {
        return handleResult({ error: e.toJSON() })
      }

      return handleResult(doc)
    }

    let doc

    try {
      logger.debug(`prerender ${url} @${profile}`)

      doc = await prerenderer.render(url, {
        timeout: JOB_TIMEOUT,
        userAgent,

        // always followRedirect when caching pages
        // in case of a request with followRedirect=true waits a cache lock of request with followRedirect=false
        followRedirect: true,
        extraMeta: {
          status: { selector: 'meta[http-equiv="Status" i]', property: 'content' },
          location: { selector: 'meta[http-equiv="Location" i]', property: 'content' },
          lastModified: { selector: 'meta[http-equiv="Last-Modified" i]', property: 'content' },
          cacheControl: { selector: 'meta[http-equiv="Cache-Control" i]', property: 'content' },
          expires: { selector: 'meta[http-equiv="Expires" i]', property: 'content' },
          error: { selector: 'meta[name="error"]', property: 'content' }
        },
        rewrites
      })

      logger.debug(`prerender ${url} @${profile} successfully`)
    } catch (e) {
      logger.debug(`prerender ${url} @${profile} failed.`, e)

      doc = {
        error: new RESTError('RENDER_ERROR', e.message).toJSON(),
        updatedAt: new Date()
      }

      updateSitemap(site, path, doc)
      updateSnapshot(doc)

      if (cacheStatus === 'BYPASS') {
        return handleResult(doc)
      }

      const staleDoc = await fetchStaleDoc()

      if (staleDoc) {
        cacheStatus = 'STALE'
        return handleResult(staleDoc)
      }

      return handleResult(doc)
    }

    doc.updatedAt = new Date()

    if (doc.meta && doc.meta.status) {
      const s = parseInt(doc.meta.status)

      if (!isNaN(s) && s >= 100 && s < 600) {
        doc.status = s

        if ([301, 302].includes(doc.status) && doc.meta.location) {
          doc.redirect = doc.meta.location
        } else if (doc.status === 503) {
          mongo.db.collection('sites').updateOne(
            { host: new URL(site).host },

            {
              $set: { [profile ? `profiles.${profile}.serviceUnavailable` : 'serviceUnavailable']: new Date() }
            }
          )
        }
      }
    }

    if (!validHTTPStatus.includes(doc.status)) {
      let message = 'HTTP ' + doc.status

      if (doc.meta && doc.meta.error) {
        message += '. ' + doc.meta.error
      }

      doc.error = new RESTError('FETCH_ERROR', url, message).toJSON()

      updateSitemap(site, path, doc)

      const staleDoc = await fetchStaleDoc()

      if (staleDoc && validHTTPStatus.includes(staleDoc.status)) {
        updateSnapshot({
          error: doc.error,
          updatedAt: doc.updatedAt
        })

        if (cacheStatus === 'BYPASS') {
          return handleResult(doc)
        }

        cacheStatus = 'STALE'
        return handleResult(staleDoc)
      }

      updateSnapshot(doc)
      return handleResult(doc)
    }

    doc.error = null

    if (doc.meta) {
      if (doc.meta.cacheControl) {
        let maxage = doc.meta.cacheControl.match(/max-age=(\d+)/)

        if (maxage) {
          maxage = parseInt(maxage[1])

          if (maxage >= 0) {
            doc.privateExpires = new Date(Date.now() + maxage * 1000)
          } else {
            maxage = null
          }
        }

        let sMaxage = doc.meta.cacheControl.match(/s-maxage=(\d+)/)

        if (sMaxage) {
          sMaxage = parseInt(sMaxage[1])

          if (sMaxage >= 0) {
            doc.sharedExpires = new Date(Date.now() + sMaxage * 1000)
          } else {
            sMaxage = null
          }
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
      doc.privateExpires = new Date(Date.now() + (doc.status < 400 ? config.cache.maxage : 10) * 1000)
    }

    if (!doc.sharedExpires) {
      doc.sharedExpires = new Date(Date.now() + (doc.status < 400 ? config.cache.sMaxage : 10) * 1000)
    }

    if (doc.sharedExpires < doc.privateExpires) {
      doc.sharedExpires = doc.privateExpires
    }

    doc.removeAt = new Date(doc.sharedExpires + config.cache.removeAfter * 1000)

    updateSitemap(site, path, doc)
    updateSnapshot(doc)

    return handleResult(doc)

    function handleResult(doc) {
      logger.log(`${url} @${profile} ${doc.error ? doc.error.code : doc.status}. queue: ${jobStartTime - msgTimestamp}ms, render: ${Date.now() - jobStartTime}ms, attemps: ${msgAttemps}`)

      if (callbackURL || replyTo) {
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

      if (!msg.hasResponded) {
        msg.finish()
      }

      jobCounter--
    }

    function updateSnapshot(doc) {
      const query = { site, path, profile, lock }
      logger.debug('update snapshot:', query)

      return snapshots.updateOne(query, {
        $set: {
          ...doc,
          lock: null
        },

        $inc: {
          renderTimes: 1
        }
      }).catch(e => logger.error(e))
    }

    function fetchStaleDoc() {
      return snapshots.findOne({ site, path, profile, status: { $type: 'int' } }).catch(e => logger.error(e))
    }
  })
}
