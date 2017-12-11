(async function() {
  const amqp = require('amqplib')

  const configFile = process.env.npm_config_config || 'default'
  console.log('load config file:', configFile)
  const config = require('./config/' + configFile)

  const conn = await amqp.connect(config.amqp.url)
  global.channel = await conn.createChannel()
  global.queue = await chan.assertQueue('renderWorker', { durable: true })

})()
