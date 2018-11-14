const { Reader } = require('nsqjs')
const { hostname } = require('os')
const RESTError = require('../shared/RESTError')
const logger = require('../shared/logger')
const { nsq: { reader: options } } = require('../shared/config')
const reply = require('./reply')

const timeout = 28 * 1000
const maxInFlight = 2500
const topic = `kasha-server-${hostname()}`
const queue = []
const reader = new Reader(topic, 'response', { ...options, maxInFlight })

reader.on('message', async msg => {
  // don't block the queue
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

function connect() {
  return new Promise((resolve, reject) => {
    function onReady() {
      reader.removeListener('error', onError)

      reader.on('error', e => {
        logger.error('Worker responder error', e)
      })

      resolve()
    }

    function onError() {
      reader.removeListener('ready', onReady)
      reject()
    }

    reader.once('ready', onReady)
    reader.once('error', onError)
    reader.connect()
  })
}

function close() {
  return new Promise((resolve, reject) => {
    clearInterval(cleanUpInterval)

    if (reader.connectionIds.length === 0) {
      return resolve()
    }

    reader.on('nsqd_closed', () => {
      if (reader.connectionIds.length === 0) {
        return resolve()
      }
    })

    reader.on('error', reject)
    reader.close()
  })
}

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

const cleanUpInterval = setInterval(() => {
  const now = Date.now()

  while (queue.length) {
    const req = queue[0]

    if (!req.ctx) { // has been consumed
      queue.shift()
    } else if (req.date + timeout > now) {
      break
    } else { // timed out
      req.reject(new RESTError('SERVER_WORKER_TIMEOUT'))
      queue.shift()
    }
  }
}, 1000)


module.exports = { connect, close, topic, addToQueue }
