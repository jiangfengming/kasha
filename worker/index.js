#!/usr/bin/env node

(async function() {
  const { URL } = require('url')
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')
  const config = require('../shared/config')

  const mongodb = require('../shared/db')
  const db = await mongodb.connect()

  const collection = db.collection('snapshot')
  /*
  schema:
  site: String
  path: String
  deviceType: String
  allowCrawl: Boolean
  status: Number
  redirect: String
  meta: Object
  openGraph: Object
  links: Array
  content: String
  error: String
  times: Number
  date: Date
  lock: String
  */

  const sitemap = db.collection('sitemap')
  /*
  schema:
  site: String
  path: String
  meta: Object
  */

  const Prerenderer = require('puppeteer-prerender')

  const prerendererOpts = {
    timeout: 24 * 1000,
    puppeteerLaunchOptions: {
      handleSIGINT: false
    }
  }

  if (config.loglevel === 'debug') {
    prerendererOpts.debug = true
    prerendererOpts.puppeteerLaunchOptions.headless = false
  }

  const prerenderer = new Prerenderer(prerendererOpts)

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

  let jobCounter = 0

  reader.on('message', async msg => {
    jobCounter++

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

    let status = null, redirect = null, meta = null, openGraph = null, links = null, content = null, error = null
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
          status,
          redirect,
          meta,
          openGraph,
          links,
          content,
          error,
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
        ({ status, redirect, meta, openGraph, links, content, error, date } = await poll(site, path, deviceType))
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
        links,
        content: metaOnly ? null : content,
        date
      })
    }

    // render the page
    try {
      ({ status, redirect, meta, openGraph, links, content } = await prerenderer.render(url, {
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
            links,
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
            links,
            content,
            error: null,
            date,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })

        // sitemap
        if (allowCrawl && meta.canonicalURL) {
          const u = new URL(meta.canonicalURL)
          await sitemap.updateOne({
            site: u.origin,
            path: u.pathname + u.search
          }, {
            $set: {
              meta,
              openGraph,
              date
            }
          }, { upsert: true })
        } else if (status < 200 || status >= 300) {
          const u = new URL(url)
          await sitemap.deleteOne({
            site: u.origin,
            path: u.pathname + u.search
          })
        }
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
        links,
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
      await mongodb.close()
    }
  })

  logger.info('Worker started')
}())
