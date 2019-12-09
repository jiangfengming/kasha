const { Writer } = require('nsqjs')
const { nsq: { writer: { host, port, options } } } = require('./config')
const logger = require('./logger')

const RECONNECT_INTERVAL = 5000

const writer = new Writer(host, port, options)

writer.on('error', () => {
  // set up a empty error handler to prevent the process from existing
})

let connectPromise, closing

function connect(force) {
  if (!force && connectPromise) {
    return connectPromise
  }

  connectPromise = new Promise((resolve, reject) => {
    logger.warn('Connecting to NSQ writer...')

    function _resolve() {
      logger.warn('NSQ writer connected')
      writer.removeListener('ready', _resolve)
      writer.removeListener('error', _reject)
      writer.on('error', onError)
      writer.on('closed', onClosed)
      resolve(writer)
    }

    function _reject(e) {
      writer.removeListener('ready', _resolve)
      writer.removeListener('error', _reject)
      reject(e)
    }

    function onError(e) {
      logger.error(e)
      writer.removeListener('error', onError)
      writer.removeListener('closed', onClosed)
      reconnect()
    }

    function onClosed() {
      const msg = 'NSQ writer connection closed.'

      if (closing) {
        logger.warn(msg)
      } else {
        onError(new Error(msg))
      }
    }

    writer.on('ready', _resolve)
    writer.on('error', _reject)
    writer.connect()
  })

  return connectPromise
}

let reconnectTimer

async function reconnect(force) {
  if (!force && reconnectTimer) {
    return
  }

  try {
    await connect(true)
    reconnectTimer = null
  } catch (err) {
    logger.error({ err }, 'Connecting to NSQ writer failed.')

    if (!closing) {
      reconnectTimer = setTimeout(() => reconnect(true), RECONNECT_INTERVAL)
    }
  }
}

async function close() {
  logger.warn('Closing NSQ writer connection...')
  closing = true

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }

  if (connectPromise) {
    try {
      await connectPromise
      const promise = new Promise(resolve => writer.once('closed', resolve))
      writer.close()
      return promise
    } catch (e) {
      // nop
    }
  }
}

module.exports = { writer, connect, close }