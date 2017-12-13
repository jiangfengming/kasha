const { SERVER_BUSY } = require('../shared/errors')
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

  if (msg.callbackUrl) {
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
    throw SERVER_BUSY
  } else {
    if (msg.callbackUrl) {
      ctx.body = {}
    }
  }
}

module.exports = { render }
