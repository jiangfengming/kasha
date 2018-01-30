const { consume } = require('./mqRPC')
const uid = require('../uid')

const queue = 'server-' + uid()

async function init() {
  const channel = await require('../mq')
  const queue = await channel.assertQueue(queue, { exclusive: true })
  channel.consume(queue, consume, { noAck: true })
  return { channel, queue }
}

module.exports = init()
