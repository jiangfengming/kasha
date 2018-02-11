const { Writer } = require('nsqjs')

const w = new Writer('127.0.0.1', 4150)

w.connect()

w.once('ready', (...args) => {
  console.log('ready', args) // eslint-disable-line
})

w.on('closed', () => {
  console.log('closed') // eslint-disable-line
  w.connect()
})

w.on('error', e => console.log('error', e)) // eslint-disable-line
