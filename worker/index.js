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

    const date = new Date()

    // lock
    const lock = uid()

    const lockQuery = {
      site,
      path,
      deviceType,
      lock: false,
      $or: [
        { retry: { $ne: 0 } }, // invalid doc, retry != 0
        { date: { $lt: new Date(date.getTime() - EXPIRE) } } // stale doc
      ]
    }

    if (followRedirect) {
      lockQuery.$or.push({ content: null })
    }

    let lockResult
    try {
      lockResult = await collection.updateOne(lockQuery, {
        lock,
        $setOnInsert: {
          allowCrawl,
          status: null,
          redirect: null,
          title: null,
          content: null,
          error: null,
          date
        }
      }, { upsert: true })
    } catch (e) {
      // duplicate key on upsert
      // there is a valid document
      if (e.code === 11000) {
        try {
          const { status, redirect, title, content, date } = await collection.findOne({ site, path, deviceType })
          return handleResult({ url, deviceType, status, redirect, title, content, date })
        } catch (e) {
          const { timestamp, eventId } = logger.error(e)
          return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        }
      } else {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }
    }

    // document has been locked by others
    // polling the result
    if (lockResult.matchedCount && !lockResult.modifiedCount) {
      const tried = 0
      const intervalId = setInterval(async() => {
        tried++

        try {
          const { status, redirect, title, content, date, locked } = await collection.findOne({ site, path, deviceType })
          if (!locked) {
            clearInterval(intervalId)
            handleResult({ url, deviceType, status, redirect, title, content, date })
          } else if (date.getTime() + prerender.timeout < Date.now()) { // timed out

          }
        } catch (e) {
          clearInterval(intervalId)
          const { timestamp, eventId } = logger.error(e)
          handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        }
      }, 5000)

      return
    }

    let status = null, redirect = null, title = null, content = null, error = null

    try {
      ({ status, redirect, title, content } = await prerender(url, {
        userAgent: userAgents[deviceType],
        followRedirect
      }))
    } catch (e) {
      error = e.message
    }

    // if error occurs, retry up to 3 times in one minute
    if (error || status >= 500 && status <= 599) {
      try {
        await collection.updateOne({ site, path, deviceType }, {
          $set: {
            allowCrawl,
            status,
            redirect,
            title,
            content,
            error,
            date
          },
          $inc: {
            retry: 1
          }
        }, { upsert: true })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      if (error) {
        return handleResult(new CustomError('SERVER_RENDER_ERROR', error))
      } else {
        return handleResult({ url, deviceType, status, redirect, title, content, date })
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
            retry: 0
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

    function handleResult(result) {
      if (callbackUrl) {
        callback(callbackUrl, result)
      } else if (msg.properties.replyTo) {
        const isFull = !mq.channel.sendToQueue(
          msg.properties.replyTo,
          Buffer.from(JSON.stringify(result)),
          {
            correlationId: msg.properties.correlationId,
            headers: {
              code: result instanceof CustomError ? result.code : 'OK'
            }
          }
        )

        if (isFull) logger.warn('Message channel\'s buffer is full')
      }

      channel.ack(msg)
    }
  })

  logger.info('Worker started')
}())
