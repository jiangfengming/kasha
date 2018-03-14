#!/usr/bin/env node

(async function() {
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')
  const config = require('../shared/config')

  const mongodb = require('../shared/db')
  const db = await mongodb.connect()

  const collection = db.collection('snapshot')
  /*
  snapshot collection schema:
  site: String
  path: String
  deviceType: String
  allowCrawl: Boolean
  status: Number
  redirect: String
  meta: Object
  openGraph: Object
  content: String
  error: String
  times: Number
  date: Date
  lock: String
  */

  const prerender = require('puppeteer-prerender')
  prerender.timeout = 24 * 1000
  if (config.loglevel === 'debug') {
    prerender.debug = true
    prerender.headless = false
  }

  const { isAllowed } = require('./robotsTxt')
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

  const EXPIRE = config.cache * 60 * 1000

  reader.on('message', async msg => {
    const req = msg.json()
    logger.debug(req)

    const {
      replyTo,
      correlationId,
      site,
      path,
      deviceType,
      callbackUrl,
      metaOnly,
      followRedirect,
      ignoreRobotsTxt
    } = req

    const url = site + path

    // check robots.txt
    let allowCrawl
    try {
      allowCrawl = await isAllowed(url)
      if (!allowCrawl && !ignoreRobotsTxt) {
        return handleResult(new CustomError('SERVER_ROBOTS_DISALLOW'))
      }
    } catch (e) {
      return handleResult(e)
    }

    let status = null, redirect = null, meta = null, openGraph = null, content = null, error = null
    let date = new Date()

    // lock
    const lock = uid()

    const lockQuery = {
      site,
      path,
      deviceType,
      lock: false,
      $or: [
        { error: { $ne: null } }, // error
        { date: { $lt: new Date(Date.now() - EXPIRE) } } // expired
      ]
    }

    if (followRedirect) {
      lockQuery.$or.push({ content: null })
    }

    try {
      await collection.updateOne(lockQuery, {
        $set: {
          allowCrawl,
          status: null,
          redirect: null,
          meta: null,
          openGraph: null,
          content: null,
          error: null,
          date,
          lock
        },
        $setOnInsert: {
          times: 0
        }
      }, { upsert: true })
    } catch (e) {
      // don't block the queue
      msg.finish()

      if (e.code !== 11000) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      // duplicate key on upsert
      // the document maybe locked by others, or is valid
      try {
        ({ status, redirect, meta, openGraph, content, error, date } = await poll(site, path, deviceType))
      } catch (e) {
        return handleResult(e)
      }

      if (error) {
        return handleResult(new CustomError(JSON.parse(error)))
      }

      return handleResult(null, {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        content: metaOnly ? null : content,
        date
      })
    }

    // render the page
    try {
      ({ status, redirect, meta, openGraph, content } = await prerender(url, {
        userAgent: userAgents[deviceType],
        // always followRedirect when caching pages
        // in case of a request with followRedirect=true waits a cache lock of request with followRedirect=false
        followRedirect: true
      }))

      if (status >= 500 && status <= 599) {
        error = new CustomError('SERVER_UPSTREAM_ERROR', 'HTTP' + status)
      }
    } catch (e) {
      error = new CustomError('SERVER_RENDER_ERROR', e.message)
    }

    if (error) {
      try {
        await collection.updateOne({ site, path, deviceType, lock }, {
          $set: {
            allowCrawl,
            status,
            redirect,
            meta,
            openGraph,
            content,
            error: JSON.stringify(error),
            date,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })

        return handleResult(error)
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }
    } else {
      try {
        await collection.updateOne({ site, path, deviceType }, {
          $set: {
            allowCrawl,
            status,
            redirect,
            meta,
            openGraph,
            content,
            error: null,
            date,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      return handleResult(null, {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        content: metaOnly ? null : content,
        date
      })
    }

    function handleResult(error, result) {
      if (callbackUrl) {
        callback(callbackUrl, error, result)
      } else if (replyTo) {
        nsqWriter.publish(replyTo, {
          correlationId,
          error,
          result
        })
      }

      if (!msg.hasResponded) msg.finish()

      logger.debug('job finished')
    }
  })

  let stopping = false

  process.on('SIGINT', async() => {
    if (stopping) {
      exit()
    } else {
      logger.info('Closing worker... Please wait 30s to finish the pending jobs. Press ctrl-c again to force.')
      stopping = true
      reader.pause()

      setTimeout(exit, 30 * 1000)
    }

    async function exit() {
      reader.close()
      nsqWriter.close()
      await prerender.close()
      await mongodb.close()
    }
  })

  logger.info('Worker started')
}())
