const nsqReader = require('../shared/nsqReader')
const { hostname } = require('os')
const RESTError = require('../shared/RESTError')
const { nsq: { reader: options } } = require('../shared/config')
const reply = require('./reply')

const timeout = 28 * 1000
const maxInFlight = 2500
const topic = `kasha-server-${hostname()}`
const queue = []

function connect() {
  const reader = nsqReader.connect(topic, 'response', { ...options, maxInFlight })

  reader.on('message', async msg => {
    // don't block the queue
    msg.finish()

    const data = msg.json()
    const req = queue.find(req => req.correlationId === data.correlationId)
    if (!req) {
      return
    }

    const { ctx, resolve, reject, type, followRedirect } = req

    if (data.error) {
      return reject(new RESTError(data.error))
    }

    data.doc.privateExpires = new Date(data.doc.privateExpires)
    data.doc.sharedExpires = new Date(data.doc.sharedExpires)
    data.doc.updatedAt = new Date(data.doc.updatedAt)

    reply(ctx, type, followRedirect, data.doc, data.cacheStatus)

    // release resources
    for (const k in req) {
      delete req[k]
    }

    resolve()
  })
}

async function close() {
  clearInterval(cleanUpInterval)
  await nsqReader.close()
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
      req.reject(new RESTError('WORKER_TIMEOUT'))
      queue.shift()
    }
  }
}, 1000)


module.exports = { connect, close, topic, addToQueue }
