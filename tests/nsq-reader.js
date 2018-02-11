const { Reader } = require('nsqjs')

const reader = new Reader('topic', 'channel', {
  lookupdHTTPAddresses: '127.0.0.1:4161',
  maxInFlight: 10
})

reader.connect()

reader.on('error', e => console.error(e)) // eslint-disable-line

reader.on('message', msg => {
  console.log(msg.body.toString(), msg.attempts, msg.timeUntilTimeout()) // eslint-disable-line
  msg.finish()
})
