(async function() {
  const argv = require('yargs').argv
  const amqp = require('amqplib')
  const { MongoClient } = require('mongodb')
  const prerender = require('puppeteer-prerender')
  const userAgents = require('../shared/userAgents')

  const rpcMode = Boolean(argv.rpc)
  const queueName = rpcMode ? 'renderWorkerRPC' : 'renderWorker'
  const configFile = argv.config || process.env.npm_config_config || 'default'
  console.log('load config file:', configFile) // eslint-disable-line
  const config = require('../config/' + configFile)

  global.mq = {}
  mq.connection = await amqp.connect(config.amqp.url)
  mq.channel = await mq.connection.createChannel()
  mq.queue = await mq.channel.assertQueue(queueName, { durable: true })
  mq.channel.prefetch(config.amqp.prefetch)

  global.mongoClient = await MongoClient.connect(config.mongodb.url)
  global.db = mongoClient.db(config.mongodb.database)

  mq.channel.consume(queueName, async msg => {
    const { url, deviceType, callbackUrl, state } = msg

    try {
      const { title, content } = await prerender(url, {
        userAgent: userAgents[deviceType]
      })


      db.collection('cache').insertOne()

      if (msg.properties.replyTo) {
        mq.channel.sendToQueue(msg.properties.replyTo, )
      }

    } catch (e) {

    }
  })
}())
