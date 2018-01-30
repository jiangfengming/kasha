const argv = require('yargs').argv

async function init() {
  const channel = await require('../mq')
  channel.prefetch(config.parallellyRenderPerWorker)
  const rpcMode = Boolean(argv.rpc)
  logger.info('RPC mode: ' + rpcMode)
  const queue = await channel.assertQueue(rpcMode ? 'renderWorkerRPC' : 'renderWorker', { durable: !rpcMode })
  return { channel, queue }
}

module.exports = init()
