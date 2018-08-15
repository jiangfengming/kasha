const { URL } = require('url')
const assert = require('assert')
const CustomError = require('../shared/CustomError')
const logger = require('../shared/logger')
const { db } = require('../shared/db')
const { writer: nsqWriter } = require('../shared/nsqWriter')
const { addToQueue, replyTo } = require('./workerResponse')
const uid = require('../shared/uid')
const callback = require('../shared/callback')
const poll = require('../shared/poll')
const reply = require('./reply')

const ERROR_EXPIRE = 60 * 1000

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop' } = ctx.query
  let { url, type = 'html', callbackURL, noWait, metaOnly, followRedirect, refresh } = ctx.query

  let site, path
  try {
    const { origin, protocol, pathname, search, hash } = new URL(url)
    assert(['http:', 'https:'].includes(protocol))
    site = origin
    path = pathname + search + hash
    url = site + path
  } catch (e) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'url')
  }

  if (!['mobile', 'desktop'].includes(deviceType)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'deviceType')
  }

  if (callbackURL) {
    try {
      assert(['http:', 'https:'].includes(new URL(callbackURL).protocol))
    } catch (e) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'callbackURL')
    }
  }

  const validValues = [undefined, '', '0', '1']
  const truthyValues = ['', '1']

  if (!['html', 'static', 'json'].includes(type)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'type')
  }

  if (!validValues.includes(noWait)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'noWait')
  } else {
    noWait = truthyValues.includes(noWait)
  }

  if (!validValues.includes(metaOnly)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'metaOnly')
  } else {
    metaOnly = truthyValues.includes(metaOnly)
  }

  if (!validValues.includes(followRedirect)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'followRedirect')
  } else {
    followRedirect = truthyValues.includes(followRedirect)
  }

  if (!validValues.includes(refresh)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'refresh')
  } else {
    refresh = truthyValues.includes(refresh)
  }

  if ((callbackURL || metaOnly) && type !== 'json') {
    type = 'json'
  }

  if (noWait && (callbackURL || metaOnly || ctx.query.type)) {
    throw new CustomError(
      'CLIENT_INVALID_PARAM',
      'noWait can\'t be used with callbackURL | metaOnly | type'
    )
  }

  logger.debug(ctx.url, {
    extra: {
      params: { url, deviceType, callbackURL, type, noWait, metaOnly, followRedirect }
    }
  })

  async function handler() {
    // to refresh the page, we make the cache expired.
    if (refresh) {
      try {
        await db.collection('snapshots').updateOne({
          site,
          path,
          deviceType,
          lock: false
        }, {
          $set: {
            updatedAt: new Date(0)
          }
        })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      return sendToWorker('MISS')
    }

    let doc
    try {
      doc = await db.collection('snapshots').findOne({ site, path, deviceType })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (!doc) {
      return sendToWorker('MISS')
    }

    const { error, times, updatedAt, sharedExpires, privateExpires, lock } = doc

    const retryLimitReached = error && times % 4 === 3 && updatedAt.getTime() + ERROR_EXPIRE > now

    if (sharedExpires && sharedExpires.getTime() >= now) {
      if (privateExpires.getTime() <= now) {
        handleResult(doc, 'UPDATING')

        if (!lock && !retryLimitReached) {
          callbackURL = null
          noWait = true
          sendToWorker()
        }

        return
      } else {
        return handleResult(doc, 'HIT')
      }
    } else if (lock) {
      // updating and no stale content available
      return handleResult(await poll(site, path, deviceType, lock), 'MISS')
    } else if (error) {
      if (retryLimitReached) {
        throw new CustomError(
          'SERVER_RENDER_ERROR',
          `Fetching ${url} failed 3 times in one minute.`
        )
      } else {
        return sendToWorker('MISS')
      }
    } else {
      return sendToWorker('EXPIRED')
    }
  }

  if (noWait || callbackURL) {
    ctx.body = { queued: true }
    handler().catch(e => {
      if (callbackURL) callback(callbackURL, e)
    })
  } else {
    return handler()
  }

  function handleResult({ html, staticHTML, error, ...doc }, cacheStatus) {
    // has error
    if (error) {
      throw new CustomError(JSON.parse(error))
    }

    doc = {
      ...doc,
      html: metaOnly ? undefined : html,
      staticHTML: metaOnly ? undefined : staticHTML
    }

    if (callbackURL) {
      callback(callbackURL, null, doc, cacheStatus)
    } else if (!noWait) {
      reply(ctx, type, followRedirect, doc, cacheStatus)
    }
  }

  function sendToWorker(cacheStatus) {
    return new Promise((resolve, reject) => {
      const msg = {
        site,
        path,
        deviceType,
        callbackURL,
        metaOnly,
        cacheStatus
      }

      let topic
      if (callbackURL || noWait) {
        topic = 'kasha-async-queue'
      } else {
        topic = 'kasha-sync-queue'
        msg.replyTo = replyTo
        msg.correlationId = uid()
      }

      nsqWriter.publish(topic, msg, e => {
        if (e) {
          const { timestamp, eventId } = logger.error(e)
          reject(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        } else {
          if (callbackURL || noWait) {
            resolve()
          } else {
            resolve(addToQueue({
              correlationId: msg.correlationId,
              ctx,
              type,
              followRedirect
            }))
          }
        }
      })
    })
  }
}

module.exports = render
