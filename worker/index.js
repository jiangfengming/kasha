(async function() {
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')
  const config = require('../shared/config')

  const db = await require('../shared/db')
  const collection = db.collection('snapshot')

  const prerender = require('puppeteer-prerender')
  prerender.timeout = 25 * 1000
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

    const date = new Date()

    // lock
    const lock = uid()

    const lockQuery = {
      site,
      path,
      deviceType,
      lock: false,
      $or: [
        { error: { $ne: null } },
        { date: { $lt: new Date(date.getTime() - EXPIRE) } } // stale doc
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
          date,
          lock
        },
        $setOnInsert: {
          tried: 0
        }
      }, { upsert: true })
    } catch (e) {
      // don't block the queue
      msg.finish()

      // duplicate key on upsert
      // the document has been locked by others
      // or the document is valid
      if (e.code === 11000) {
        try {
          const doc = await collection.findOne({ site, path, deviceType })
          // locked by others. polling the result
          if (doc.lock) {
            let tried = 0
            const intervalId = setInterval(async() => {
              tried++

              try {
                const pollingResult = await collection.findOne({ site, path, deviceType })
                if (!pollingResult.lock) { // unlocked
                  clearInterval(intervalId)
                  handleResult(doc2result(pollingResult))
                } else if (tried >= 5) {
                  clearInterval(intervalId)

                  const error = new CustomError('SERVER_CACHE_LOCK_TIMEOUT', url)

                  if (doc.lock === pollingResult.lock) {
                    try {
                      await collection.updateOne({
                        site,
                        path,
                        deviceType,
                        lock: doc.lock
                      }, {
                        $set: {
                          error: JSON.stringify(error),
                          date,
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
              } catch (e) {
                clearInterval(intervalId)
                const { timestamp, eventId } = logger.error(e)
                handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
              }
            }, 5000)
          } else {
            handleResult(doc2result(doc))
          }
        } catch (e) {
          const { timestamp, eventId } = logger.error(e)
          handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        }
      } else {
        const { timestamp, eventId } = logger.error(e)
        handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      return
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
            date,
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
            date,
            tried: 0,
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
        date
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
