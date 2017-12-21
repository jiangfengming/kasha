(async function() {
  const argv = require('yargs').argv
  const amqp = require('amqplib')
  const { MongoClient } = require('mongodb')
  const prerender = require('puppeteer-prerender')

  const config = require('../shared/config')
  const userAgents = require('../shared/userAgents')
  const callback = require('../shared/callback')
  const CustomError = require('../shared/CustomError')

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
    const { url, deviceType, callbackUrl, state } = msg

    function handleError(e) {
      if (callbackUrl) {

      } else {

      }
    }

    let title, content
    try {
      ({ title, content }) = await prerender(url, {
        userAgent: userAgents[deviceType]
      })
    } catch (e) {
      return handleError(new CustomError('SERVER_RENDER_ERROR', e.message))
    }

    const doc = {
      url,
      deviceType,
      title,
      content,
      date: new Date()
    }

    try {
      db.collection('cache').updateOne({ url, deviceType }, doc, { upsert: true })
    } catch (e) {
      console.error(e, ) // eslint-disable-line
      return handleError(new CustomError('SERVER_INTERNAL_ERROR', ))
    }



    if (callbackUrl) {
      await callback(callbackUrl, doc)
    } else {
      const isFull = mq.channel.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify(doc)), { correlationId: msg.properties.correlationId })
      if (isFull) {
        console.warn("Message channel's buffer is full") // eslint-disable-line
      }
    }

    mq.channel.ack(msg)
  })
}())
