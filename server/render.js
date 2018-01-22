const { URL } = require('url')
const assert = require('assert')
const uid = require('../uid')
const mpRPC = require('./mqRPC')
const callback = require('../shared/callback')
const config = require('../shared/config')

const EXPIRE = config.cache * 60 * 1000
const ERROR_EXPIRE = 60 * 1000

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop', callbackUrl, format = 'json' } = ctx.query
  let { url, noWait, metaOnly, followRedirect } = ctx.query

  try {
    url = new URL(url)
    assert(['http:', 'https:'].includes(url.protocol))
    url = url.href // normalize
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

  if (![undefined, ''].includes(metaOnly)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'metaOnly')
  } else {
    metaOnly = metaOnly === ''
  }

  if (![undefined, ''].includes(followRedirect)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'followRedirect')
  } else {
    followRedirect = followRedirect === ''
  }

  if (format === 'html' && (noWait || callbackUrl || metaOnly)) {
    throw new CustomError(
      'CLIENT_INVALID_PARAM',
      'callbackUrl|noWait|metaOnly can\'t be set when output format is html'
    )
  }

  async function handler() {
    let snapshot
    try {
      snapshot = await db.collection('snapshot').findOne({ url, deviceType })
      if (metaOnly) delete snapshot.content
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (snapshot) {
      if (callbackUrl) {
        callback(callbackUrl, snapshot)
      } else if (!noWait) {
        if (retry >= 3 && snapshot.date.getTime() + ERROR_EXPIRE > now) {
          throw new CustomError(
            'SERVER_RENDER_ERROR',
            `Fetching ${url} failed 3 times in one minute (${error || ('HTTP ' + status)}).`
          )
        }
      }

      const success = callback(ctx, snapshot, { format, followRedirect })

      if (success) {
        // refresh cache
        if (snapshot.date.getTime() + EXPIRE < now) {

        }

        return
      } else {
        if ()

      }

      if (date.getTime() + 1000 < now && retry < 3) {
        // nop
      } else {
      }


    }

    const msg = Buffer.from(JSON.stringify({
      url,
      deviceType,
      callbackUrl,
      metaOnly,
      followRedirect
    }))

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
      return mpRPC.add({
        ctx,
        correlationId: msgOpts.correlationId,
        date: now,
        format,
        metaOnly,
        followRedirect
      })
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
