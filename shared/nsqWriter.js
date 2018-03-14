const { Writer } = require('nsqjs')
const { nsq: { writer: { host, port, options } } } = require('./config')

const me = {
  writer: null,

  connect() {
    if (me.writer) return me.writer

    return new Promise((resolve, reject) => {
      const writer = new Writer(host, port, options)

      writer.once('error', reject)

      writer.once('ready', () => {
        writer.removeAllListeners()
        me.writer = writer
        resolve(writer)
      })

      writer.connect()
    })
  }
}

module.exports = me
