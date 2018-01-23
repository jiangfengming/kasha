(async function() {
  const argv = require('yargs').argv
  const amqp = require('amqplib')
  const { MongoClient } = require('mongodb')
  const prerender = require('puppeteer-prerender')

  const config = require('../shared/config')
  const userAgents = require('../shared/userAgents')
  const callback = require('../shared/callback')
  const CustomError = require('../shared/CustomError')
  const { isAllowed } = require('./robotsTxt')

  const rpcMode = Boolean(argv.rpc)
  const queueName = rpcMode ? 'renderWorkerRPC' : 'renderWorker'

  prerender.timeout = 25 * 1000

  global.mq = {}
  mq.connection = await amqp.connect(config.amqp.url)
  mq.channel = await mq.connection.createChannel()
  mq.queue = await mq.channel.assertQueue(queueName, { durable: true })
  mq.channel.prefetch(config.amqp.prefetch)

  global.mongoClient = await MongoClient.connect(config.mongodb.url)
  global.db = mongoClient.db(config.mongodb.database)

  const collection = db.collection('cache')

  mq.channel.consume(queueName, async msg => {
    const { url, deviceType, callbackUrl, metaOnly, followRedirect } = JSON.parse(msg.content.toString())

    // check robots.txt
    if (!await isAllowed(url)) {
      return handleResult(new CustomError('SERVER_ROBOTS_DISALLOW'))
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
        await collection.updateOne({ url, deviceType }, {
          $set: {
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
        await db.collection('cache').updateOne({ url, deviceType }, {
          $set: {
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

      return handleResult({ url, deviceType, status, redirect, title, content, date })
    }

    function handleResult(result) {
      if (!(result instanceof CustomError) && metaOnly) {
        delete result.content
      }

      if (callbackUrl) {
        callback(callbackUrl, result)
      } else if (msg.properties.replyTo) {
        const isFull = mq.channel.sendToQueue(
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

      mq.channel.ack(msg)
    }
  })
}())
