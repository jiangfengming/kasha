const { URL } = require('url')
const assert = require('assert')
const { uid, filterResult } = require('../util')
const DOC_FIELDS = ['url', 'deviceType', 'title', 'content', 'date']
const { add } = require('./mqRPC')

async function render(ctx) {
  const now = Date.now()
  const { url, deviceType = 'desktop', callbackUrl, state = '', format = 'json' } = ctx.query
  let { noWait, fields, followRedirect } = ctx.query

  try {
    assert(['http:', 'https:'].includes(new URL(url).protocol))
  } catch (e) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'url')
  }

  if (!['mobile', 'desktop'].includes(deviceType)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'deviceType')
  }

  if (callbackUrl) {
    try {
      assert(['http:', 'https:'].includes(new URL(callbackUrl).protocol))
    } catch (e) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'callbackUrl')
    }
  }

  if (!['json', 'html'].includes(format)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'format')
  }

  if (![undefined, ''].includes(noWait)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'noWait')
  } else {
    noWait = noWait === ''
  }

  if (![undefined, ''].includes(followRedirect)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'followRedirect')
  } else {
    followRedirect = followRedirect === ''
  }

  if (fields) {
    fields = fields.split(',')
    if (!fields.every(e => DOC_FIELDS.includes(e))) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'fields')
    }
  }

  async function handler() {
    let snapshot
    try {
      snapshot = await db.collection('snapshot').findOne({ url, deviceType })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (snapshot) {
      if (format === 'html') {
        ctx.body = snapshot.content
      } else {
        ctx.body = fields ? filterResult(snapshot, fields) : snapshot
      }
    } else {
      const msg = Buffer.from(JSON.stringify({ url, deviceType, callbackUrl, state, fields, followRedirect }))

      let queue, msgOpts
      if (callbackUrl || noWait) {
        queue = 'renderWorker'
        msgOpts = {
          persistent: true
        }
      } else {
        queue = 'renderWorkerRPC'
        msgOpts = {
          correlationId: uid(),
          replyTo: mq.queue.queue
        }
      }

      msgOpts.contentType = 'application/json'

      const isFull = mq.channel.sendToQueue(queue, msg, msgOpts)

      if (isFull) logger.warn('Message channel\'s buffer is full')

      if (callbackUrl || noWait) {
        ctx.body = {} // end
      } else {
        return add({
          ctx,
          correlationId: msgOpts.correlationId,
          date: now
        })
      }
    }
  }

  const promise = handler()

  if (noWait) {
    ctx.body = {}
  } else {
    return promise
  }
}

module.exports = render
