const amqp = require('amqplib')
const config = require('./config')

let channel

async function connect() {
  if (channel) return channel

  const connection = await amqp.connect(config.amqp.url)
  channel = await connection.createConfirmChannel()

  connection.on('error', )

  return channel
}

module.exports = connect()
