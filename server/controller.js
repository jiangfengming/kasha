const { URL } = require('url')
const crypto = require('crypto')
const assert = require('assert')

function genUid() {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(16, (err, buf) => {
      if (err) reject(err)
      else resolve(buf.toString('base64'))
    })
  })
}

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

  const cache = await db.collection('cache').findOne({ url, deviceType })
  if (cache) {
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
        correlationId: await genUid(),
        replyTo: mq.queue.queue
      }
    }

    msgOpts.persistent = true
    msgOpts.contentType = 'application/json'

    const isFull = mq.channel.sendToQueue(queue, msg, msgOpts)

    if (isFull) {
      console.warn("Message channel's buffer is full") // eslint-disable-line
    }

    if (callbackUrl) {
      ctx.body = {} // end
    } else {
      // todo
    }
  }
}

module.exports = { render }
