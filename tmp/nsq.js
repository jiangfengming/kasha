const { Reader, Writer } = require('nsqjs')

const reader = new Reader('topic', 'channel', {
  nsqdTCPAddresses: '127.0.0.1:4150',
  maxInFlight: 10
})

reader.connect()

reader.on('error', e => console.error(e)) // eslint-disable-line

reader.on('message', msg => {
  console.log(msg.body.toString(), msg.attempts, msg.timeUntilTimeout()) // eslint-disable-line
  msg.finish()
})


const w = new Writer('127.0.0.1', 4150)

w.connect()

w.once('ready', () => {
  console.log('ready') // eslint-disable-line
  w.publish('topic', ['foo', 'bar'])
})

w.on('closed', () => {
  console.log('closed') // eslint-disable-line
  w.connect()
})

w.on('error', e => console.log('error', e)) // eslint-disable-line
