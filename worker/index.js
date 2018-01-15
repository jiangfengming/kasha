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

  global.mq = {}
  mq.connection = await amqp.connect(config.amqp.url)
  mq.channel = await mq.connection.createChannel()
  mq.queue = await mq.channel.assertQueue(queueName, { durable: true })
  mq.channel.prefetch(config.amqp.prefetch)

  global.mongoClient = await MongoClient.connect(config.mongodb.url)
  global.db = mongoClient.db(config.mongodb.database)

  mq.channel.consume(queueName, async msg => {
    const { url, deviceType, callbackUrl, state } = JSON.parse(msg.content.toString())

    function handleResult(result) {
      if (callbackUrl) {
        callback(callbackUrl, url, state, result)
      } else if (msg.properties.replyTo) {
        const isFull = mq.channel.sendToQueue(
          msg.properties.replyTo,
          Buffer.from(JSON.stringify(result)),
          {
            correlationId: msg.properties.correlationId,
            headers: {
              status: result instanceof CustomError ? result.status : 200
            }
          }
        )

        if (isFull) logger.warn('Message channel\'s buffer is full')
      }

      mq.channel.ack(msg)
    }

    if (!await isAllowed(url)) {
      return handleResult(new CustomError('SERVER_ROBOTS_DISALLOW'))
    }

    const date = new Date()
    let title, content
    try {
      ({ title, content } = await prerender(url, {
        userAgent: userAgents[deviceType]
      }))
    } catch (e) {
      return handleResult(new CustomError('SERVER_RENDER_ERROR', e.message))
    }

    const doc = {
      url,
      deviceType,
      title,
      content,
      date
    }

    try {
      await db.collection('cache').updateOne({ url, deviceType }, { $set: doc }, { upsert: true })
    } catch (e) {
      logger.error(e)
    }

    return handleResult(doc)
  })
}())
