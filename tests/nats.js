const NATS = require('nats')
const nats = NATS.connect()

nats.publish('foo', 'hello')
nats.publish('foo', 'hello')
nats.publish('foo', 'hello')
nats.publish('foo', 'hello')
nats.publish('foo', 'hello')
nats.publish('foo', 'hello')
nats.publish('foo', 'hello')
nats.publish('foo', 'hello')

// function consume() {
//   nats.subscribe('foo', { queue: 'async-workers', max: 1 }, (msg, replyTo) => {
//     console.log(msg, replyTo) // eslint-disable-line
//     consume()
//     // setTimeout(consume, 1000)
//   })
// }

// consume()

setTimeout(() => {
  nats.subscribe('foo', { queue: 'async-workers' }, (msg, replyTo) => console.log(msg, replyTo)) // eslint-disable-line
})
