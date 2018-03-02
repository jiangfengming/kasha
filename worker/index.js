(async function() {
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')
  const config = require('../shared/config')

  const db = await require('../shared/db').connect()
  const collection = db.collection('snapshot')
  /*
  snapshot collection schema:
  site: String
  path: String
  deviceType: String
  allowCrawl: Boolean
  status: Number
  redirect: String
  title: String
  content: String
  error: String
  tried: Number
  date: Date
  lock: String
  */

  const prerender = require('puppeteer-prerender')
  prerender.timeout = 24 * 1000
  const { isAllowed } = require('./robotsTxt')
  const userAgents = require('./userAgents')

  const uid = require('../shared/uid')
  const callback = require('../shared/callback')

  const argv = require('yargs').argv
  const { Reader } = require('nsqjs')
  const topic = argv.rpc ? 'syncQueue' : 'asyncQueue'
  const reader = new Reader(topic, 'worker', config.nsq.reader)
  reader.connect()

  const nsqWriter = require('../shared/nsqWriter')

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

    function doc2result({ status, redirect, title, content, error, date }) {
      return error
        ? new CustomError(JSON.parse(error))
        : {
          url,
          deviceType,
          status,
          redirect,
          title,
          content: metaOnly ? null : content,
          date
        }
    }

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
          title: null,
          content: null,
          error: null,
          date: new Date(),
          lock
        },
        $setOnInsert: {
          tried: 0
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
      let tried = 0
      let initialLock
      const polling = async() => {
        tried++

        let pollingResult
        try {
          pollingResult = await collection.findOne({ site, path, deviceType })
        } catch (e) {
          clearInterval(intervalId)
          const { timestamp, eventId } = logger.error(e)
          return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        }

        if (!pollingResult.lock) { // unlocked
          clearInterval(intervalId)
          handleResult(doc2result(pollingResult))
        } else {
          if (!initialLock) initialLock = pollingResult.lock

          if (tried > 5) {
            clearInterval(intervalId)

            const error = new CustomError('SERVER_CACHE_LOCK_TIMEOUT', 'snapshot')

            // if the same lock lasts 25s, the other worker may went wrong
            // we remove the lock
            if (initialLock === pollingResult.lock) {
              try {
                await collection.updateOne({
                  site,
                  path,
                  deviceType,
                  lock: initialLock
                }, {
                  $set: {
                    error: JSON.stringify(error),
                    date: new Date(),
                    lock: false
                  }
                })
              } catch (e) {
                const { timestamp, eventId } = logger.error(e)
                return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
              }
            }

            handleResult(error)
          }
        }
      }

      const intervalId = setInterval(polling, 5000)
      polling()
    }

    // render the page
    let status = null, redirect = null, title = null, content = null, error = null

    try {
      ({ status, redirect, title, content } = await prerender(url, {
        userAgent: userAgents[deviceType],
        followRedirect
      }))
    } catch (e) {
      error = e.message
    }

    if (error || status >= 500 && status <= 599) {
      try {
        error = error
          ? new CustomError('SERVER_RENDER_ERROR', error)
          : new CustomError('SERVER_UPSTREAM_ERROR', 'HTTP' + status)

        await collection.updateOne({ site, path, deviceType, lock }, {
          $set: {
            allowCrawl,
            status,
            redirect,
            title,
            content,
            error: JSON.stringify(error),
            date: new Date(),
            lock: false
          },
          $inc: {
            tried: 1
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
            title,
            content,
            error: null,
            tried: 0,
            date: new Date(),
            lock: false
          }
        }, { upsert: true })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      return handleResult({
        url,
        deviceType,
        status,
        redirect,
        title,
        content: metaOnly ? null : content,
        date: new Date()
      })
    }

    function handleResult(data) {
      if (callbackUrl) {
        callback(callbackUrl, data)
      } else if (replyTo) {
        nsqWriter.publish(replyTo, {
          correlationId,
          data
        })
      }

      if (!msg.hasResponded) {
        msg.finish()
      }
    }
  })

  logger.info('Worker started')
}())
