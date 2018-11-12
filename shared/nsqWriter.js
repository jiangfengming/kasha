const { Writer } = require('nsqjs')
const { nsq: { writer: { host, port, options } } } = require('./config')
const logger = require('./logger')

const writer = new Writer(host, port, options),

function connect() {
  if (writer.ready) return writer

  return new Promise((resolve, reject) => {
    let resolved = false

    function onReady() {
      writer.removeListener('error', onError)
      writer.on('error', )
      writer.on('closed', onClosed)
      resolved = true
      resolve(writer)
    }

    function onError(e) {
      reject(e)
    }

    function onClosed() {
      logger.info('nsq writer connection closed')
    }

    this.writer.on('error', e => {
      if (!resolved) {
        reject(e)
      } else {
        // auto reconnect on connection error
        logger.error(e)
        this.reconnect()
      }
    })

    writer.connect()
  })
}

module.exports = {



  reconnect() {
    if (this.writer.ready) return
    logger.info('reconnecting to NSQ writer...')

    this.writer.removeListener('error', this.)
    this.writer.once('ready', () => {

    })
    this.writer.connect()

  },

  close() {
    return new Promise(resolve => {
      if (!this.writer.ready) {
        return resolve()
      }

      this.writer.once('closed', resolve)
      this.writer.close()
    })
  }
}
