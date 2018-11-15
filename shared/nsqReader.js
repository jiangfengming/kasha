const { Reader } = require('nsqjs')
const logger = require('./logger')

const singleton = {
  reader: null,

  connect(topic, channel, options) {
    return new Promise((resolve, reject) => {
      singleton.reader = new Reader(topic, channel, options)

      function _resolve() {
        singleton.reader.removeListener('error', _reject)

        singleton.reader.on('error', e => {
          logger.error(e)
        })

        resolve(singleton.reader)
      }

      function _reject() {
        singleton.reader.removeListener('ready', _resolve)
        reject()
      }

      singleton.reader.once('ready', _resolve)
      singleton.reader.once('error', _reject)
      singleton.reader.connect()
    })
  },

  close() {
    return new Promise((resolve, reject) => {
      if (singleton.reader.connectionIds.length === 0) {
        return resolve()
      }

      singleton.reader.on('nsqd_closed', () => {
        if (singleton.reader.connectionIds.length === 0) {
          return resolve()
        }
      })

      singleton.reader.on('error', reject)
      singleton.reader.close()
    })
  }
}


module.exports = singleton
