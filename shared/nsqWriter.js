const { Writer } = require('nsqjs')
const { nsq: { writer: { host, port, options } } } = require('./config')

const singleton = {
  writer: null,

  connect() {
    if (singleton.writer) return singleton.writer

    return new Promise((resolve, reject) => {
      const writer = new Writer(host, port, options)

      writer.once('error', reject)

      writer.once('ready', () => {
        writer.removeAllListeners()
        singleton.writer = writer
        resolve(writer)
      })

      writer.connect()
    })
  }
}

module.exports = singleton
