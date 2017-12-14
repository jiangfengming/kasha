const { URL } = require('url')
const crypto = require('crypto')

function genUid() {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(16, (err, buf) => {
      if (err) reject(err)
      else resolve(buf.toString('base64'))
    })
  })
}

async function render(ctx) {
  let msgOpts
  const msg = {
    url: ctx.query.url,
    callbackUrl: ctx.query.callbackUrl
  }

  try {
    new URL(ctx.query.url)
  } catch (e) {
    throw new CustomError('CLIENT_INVALID_URL')
  }

  if (msg.callbackUrl) {
    try {
      new URL(msg.callbackUrl)
    } catch (e) {
      throw new CustomError('CLIENT_INVALID_CALLBACK_URL')
    }
    msgOpts = {}
  } else {
    msgOpts = {
      correlationId: await genUid(),
      replyTo: mq.queue.queue,
      persistent: true
    }
  }

  const sended = mq.channel.sendToQueue('renderWorker', Buffer.from(JSON.stringify(msg)), {
    ...msgOpts,
    contentType: 'application/json'
  })

  if (!sended) {
    throw new CustomError('SERVER_BUSY')
  } else {
    if (msg.callbackUrl) {
      ctx.body = {}
    } else {
      // todo
    }
  }
}

module.exports = { render }
