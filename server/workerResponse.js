const RESTError = require('../shared/RESTError')

const { Reader } = require('nsqjs')
const { hostname } = require('os')
const { nsq: { reader: options } } = require('../shared/config')
const reply = require('./reply')
const topic = 'kasha-server-' + hostname()
const maxInFlight = 2500
const reader = new Reader(topic, 'response', { ...options, maxInFlight })
reader.connect()

const TIMEOUT = 28 * 1000
const queue = []

const interval = setInterval(() => {
  const now = Date.now()

  while (queue.length) {
    const req = queue[0]

    if (!req.ctx) { // has been consumed
      queue.shift()
    } else if (req.date + TIMEOUT > now) {
      break
    } else { // timed out
      req.reject(new RESTError('SERVER_WORKER_TIMEOUT'))
      queue.shift()
    }
  }
}, 1000)

// { correlationId, ctx, type, followRedirect }
function addToQueue(req) {
  return new Promise((resolve, reject) => {
    queue.push({
      ...req,
      date: Date.now(),
      resolve,
      reject
    })
  })
}

reader.on('message', async msg => {
  // don't block queue
  msg.finish()

  const data = msg.json()
  const req = queue.find(req => req.correlationId === data.correlationId)
  if (!req) return

  const { ctx, resolve, reject, type, followRedirect } = req

  if (data.error) return reject(new RESTError(data.error))

  data.doc.privateExpires = new Date(data.doc.privateExpires)
  data.doc.sharedExpires = new Date(data.doc.sharedExpires)

  reply(ctx, type, followRedirect, data.doc, data.cacheStatus)

  // release resources
  for (const k in req) delete req[k]

  resolve()
})

module.exports = { reader, interval, addToQueue, replyTo: topic }
