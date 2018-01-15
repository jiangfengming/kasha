const { URL } = require('url')
const assert = require('assert')
const uid = require('../shared/uid')

async function render(ctx) {
  const { url, deviceType = 'desktop', callbackUrl, state = '' } = ctx.query

  try {
    assert(['http:', 'https:'].includes(new URL(url).protocol))
  } catch (e) {
    throw new CustomError('CLIENT_INVALID_URL')
  }

  if (!['mobile', 'desktop'].includes(deviceType)) {
    throw new CustomError('CLIENT_INVALID_DEVICE_TYPE')
  }

  if (callbackUrl) {
    try {
      assert(['http:', 'https:'].includes(new URL(callbackUrl).protocol))
    } catch (e) {
      throw new CustomError('CLIENT_INVALID_CALLBACK_URL')
    }
  }

  let snapshot
  try {
    snapshot = await db.collection('snapshot').findOne({ url, deviceType })
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }

  if (snapshot) {
    // todo
  } else {
    const msg = Buffer.from(JSON.stringify({ url, deviceType, callbackUrl, state }))

    let queue, msgOpts
    if (callbackUrl) {
      queue = 'renderWorker'
      msgOpts = {}
    } else {
      queue = 'renderWorkerRPC'
      msgOpts = {
        correlationId: uid(),
        replyTo: mq.queue.queue
      }
    }

    msgOpts.persistent = true
    msgOpts.contentType = 'application/json'

    const isFull = mq.channel.sendToQueue(queue, msg, msgOpts)

    if (isFull) logger.warn('Message channel\'s buffer is full')

    if (callbackUrl) {
      ctx.body = {} // end
    } else {
      // todo
    }
  }
}

module.exports = render
