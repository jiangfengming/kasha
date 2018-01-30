(async function() {
  const config = require('../shared/config')
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')
  const db = await require('../shared/db')
  const { channel, queue } = await require('./mq')

  const prerender = require('puppeteer-prerender')
  prerender.timeout = 25 * 1000
  const callback = require('../shared/callback')
  const userAgents = require('./userAgents')
  const { isAllowed } = require('./robotsTxt')

  const collection = db.collection('snapshot')

  channel.consume(queue, async msg => {
    const msgContent = JSON.parse(msg.content.toString())
    logger.debug(msgContent)

    const { site, path, deviceType, callbackUrl, metaOnly, followRedirect, ignoreRobotsTxt } = msgContent
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
