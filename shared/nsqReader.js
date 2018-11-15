const { Reader } = require('nsqjs')
const logger = require('./logger')

const singleton = {
  reader: null,

  connect(topic, channel, options) {
    singleton.reader = new Reader(topic, channel, options)

    singleton.reader.on('error', e => {
      logger.error(e)
    })

    singleton.reader.connect()
    return singleton.reader
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
