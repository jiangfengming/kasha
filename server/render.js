const { URL } = require('url')
const assert = require('assert')
const mpRPC = require('./mqRPC')
const uid = require('../shared/uid')
const callback = require('../shared/callback')
const config = require('../shared/config')

const EXPIRE = config.cache * 60 * 1000
const ERROR_EXPIRE = 60 * 1000

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop' } = ctx.query
  let { url, callbackUrl, proxy, noWait, metaOnly, followRedirect } = ctx.query

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

  if (![undefined, ''].includes(proxy)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'proxy')
  } else {
    proxy = proxy === ''
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

  if (proxy && (callbackUrl || noWait || metaOnly)) {
    throw new CustomError(
      'CLIENT_INVALID_PARAM',
      'callbackUrl|noWait|metaOnly can\'t be set in proxy mode'
    )
  }

  logger.debug(ctx.url, {
    extra: {
      params: { url, deviceType, callbackUrl, proxy, noWait, metaOnly, followRedirect }
    }
  })

  async function handler() {
    let snapshot
    try {
      snapshot = await db.collection('snapshot').findOne({ url, deviceType })
      if (metaOnly) delete snapshot.content
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (!snapshot) return sendToWorker()

    const { status, redirect, content, error, date, retry } = snapshot
    if (metaOnly) delete snapshot.content

    if (retry) { // error cache
      if (retry >= 3 && date.getTime() + ERROR_EXPIRE > now) {
        throw new CustomError(
          'SERVER_RENDER_ERROR',
          `Fetching ${url} failed 3 times in one minute (${error || ('HTTP ' + status)}).`
        )
      } else {
        return sendToWorker()
      }
    } else {
      if (callbackUrl) {
        callback(callbackUrl, snapshot)
      } else if (proxy) {
        if (redirect && !followRedirect) {
          ctx.status = status
          ctx.redirect(redirect)
        } else {
          ctx.status = status
          ctx.body = content || ''
        }
      } else if (!noWait) {
        ctx.body = snapshot
      }

      // refresh cache
      if (date.getTime() + EXPIRE < now) {
        sendToWorker(true)
      }
    }
  }

  function sendToWorker(refresh = false) {
    if (refresh) {
      logger.debug('refresh ' + url)
      noWait = true
      proxy = false
      callbackUrl = null
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

    const isFull = !mq.channel.sendToQueue(queue, msg, msgOpts)

    if (isFull) logger.warn('Message channel\'s buffer is full')

    if (callbackUrl) {
      ctx.body = { queued: true } // end
    } else if (!noWait) {
      return mpRPC.add({ // promise
        ctx,
        correlationId: msgOpts.correlationId,
        date: now,
        proxy,
        metaOnly,
        followRedirect
      })
    }
  }

  if (noWait) {
    ctx.body = { queued: true }
    handler()
  } else {
    return handler()
  }
}

module.exports = render
