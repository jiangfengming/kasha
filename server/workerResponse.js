const CustomError = require('../shared/CustomError')

const { Reader } = require('nsqjs')
const { hostname } = require('os')
const { nsq: { reader: options } } = require('../shared/config')

const topic = 'kasha-server-' + hostname()
const maxInFlight = 2500
const reader = new Reader(topic, 'response', { ...options, maxInFlight })
reader.connect()

const TIMEOUT = 28 * 1000
const queue = []

setInterval(() => {
  const now = Date.now()

  while (queue.length) {
    const req = queue[0]

    if (!req.ctx) { // has been consumed
      queue.shift()
    } else if (req.date + TIMEOUT > now) {
      break
    } else { // timed out
      req.reject(new CustomError('SERVER_WORKER_TIMEOUT'))
      queue.shift()
    }
  }
}, 1000)

// { correlationId, ctx, proxy, followRedirect }
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

  const { ctx, resolve, reject, proxy, followRedirect } = req

  if (data.error) return reject(new CustomError(data.error))

  if (proxy) {
    const { status, redirect, content } = data.result
    if (redirect && !followRedirect) {
      ctx.status = status
      ctx.redirect(redirect)
    } else {
      ctx.status = status
      ctx.body = content || ''
    }
  } else {
    ctx.body = data.result
  }

  // release resource
  for (const k in req) delete req[k]

  resolve()
})

module.exports = { reader, addToQueue, replyTo: topic }
