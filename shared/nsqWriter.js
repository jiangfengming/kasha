const { Writer } = require('nsqjs')
const { nsq: { writer: { host, port, options } } } = require('./config')

const writer = new Writer(host, port, options)
const promise = new Promise((resolve, reject) => {
  writer.once('error', reject)

  writer.once('ready', () => {
    writer.removeAllListeners()
    resolve(writer)
  })
})

module.exports = promise
