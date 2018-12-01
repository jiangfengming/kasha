const { Writer } = require('nsqjs')
const { nsq: { writer: { host, port, options } } } = require('./config')
const logger = require('./logger')

const RECONNECT_INTERVAL = 5000

const writer = new Writer(host, port, options)
let connectPromise

function connect() {
  if (connectPromise) return connectPromise

  connectPromise = new Promise((resolve, reject) => {
    logger.info('Connecting to NSQ writer...')

    function _resolve() {
      logger.info('NSQ writer connected')
      writer.removeListener('error', _reject)
      writer.on('error', onError)
      writer.on('closed', onClosed)
      resolve(writer)
    }

    function _reject(e) {
      writer.removeListener('ready', _resolve)
      connectPromise = null
      reject(e)
    }

    function onError(e) {
      logger.error(e)
      writer.removeListener('error', onError)
      writer.removeListener('closed', onClosed)
      connectPromise = null
      reconnect()
    }

    function onClosed() {
      logger.info('nsq writer connection closed')
    }

    writer.on('ready', _resolve)
    writer.on('error', _reject)
    writer.on('error', () => {
      // set up a empty error handler to prevent the process from existing
    })
    writer.connect()
  })

  return connectPromise
}

let reconnectTimer
async function reconnect() {
  try {
    logger.info('reconnecting to NSQ writer...')
    await connect()
    logger.info('NSQ writer connected')
    reconnectTimer = null
  } catch (e) {
    logger.error(e)
    if (!closing) {
      reconnectTimer = setTimeout(reconnect, RECONNECT_INTERVAL)
    }
  }
}

let closing = false
function close() {
  return new Promise(async resolve => {
    logger.info('Closing NSQ writer connection...')
    closing = true

    if (reconnectTimer) clearTimeout(reconnectTimer)

    if (connectPromise) {
      try {
        await connectPromise
        writer.once('closed', _resolve)
        writer.close()
      } catch (e) {
        _resolve()
      }
    } else {
      _resolve()
    }

    function _resolve() {
      logger.info('NSQ writer connection closed.')
      resolve()
    }
  })
}

module.exports = { writer, connect, close }