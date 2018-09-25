const { URL } = require('url')
const assert = require('assert')
const RESTError = require('../shared/RESTError')
const logger = require('../shared/logger')
const { db } = require('../shared/mongo')
const { writer: nsqWriter } = require('../shared/nsqWriter')
const { addToQueue, replyTo } = require('./workerResponse')
const uid = require('../shared/uid')
const callback = require('../shared/callback')
const poll = require('../shared/poll')
const reply = require('./reply')

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop', callbackURL } = ctx.query
  let { url, type = 'html', noWait, metaOnly, followRedirect, refresh } = ctx.query

  let site, path
  try {
    const { origin, protocol, pathname, search, hash } = new URL(url)
    assert(['http:', 'https:'].includes(protocol))
    site = origin
    path = pathname + search + hash
    url = site + path
  } catch (e) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'url')
  }

  if (!['mobile', 'desktop'].includes(deviceType)) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'deviceType')
  }

  if (callbackURL) {
    try {
      assert(['http:', 'https:'].includes(new URL(callbackURL).protocol))
    } catch (e) {
      throw new RESTError('CLIENT_INVALID_PARAM', 'callbackURL')
    }
  }

  const validValues = [undefined, '', '0', '1']
  const truthyValues = ['', '1']

  if (!['html', 'static', 'json'].includes(type)) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'type')
  }

  if (!validValues.includes(noWait)) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'noWait')
  } else {
    noWait = truthyValues.includes(noWait)
  }

  if (!validValues.includes(metaOnly)) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'metaOnly')
  } else {
    metaOnly = truthyValues.includes(metaOnly)
  }

  if (!validValues.includes(followRedirect)) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'followRedirect')
  } else {
    followRedirect = truthyValues.includes(followRedirect)
  }

  if (!validValues.includes(refresh)) {
    throw new RESTError('CLIENT_INVALID_PARAM', 'refresh')
  } else {
    refresh = truthyValues.includes(refresh)
  }

  if ((callbackURL || metaOnly) && type !== 'json') {
    type = 'json'
  }

  if (noWait && (callbackURL || metaOnly || ctx.query.type)) {
    throw new RESTError(
      'CLIENT_INVALID_PARAM',
      'noWait can\'t be used with callbackURL | metaOnly | type'
    )
  }

  logger.debug(ctx.url, {
    extra: {
      params: { url, deviceType, callbackURL, type, noWait, metaOnly, followRedirect }
    }
  })

  if (noWait || callbackURL) {
    ctx.body = { queued: true }

    // don't let handler() block the request
    handler().catch(e => {
      if (callbackURL) callback(callbackURL, e)
    })
  } else {
    return handler()
  }

  async function handler() {
    let doc

    try {
      doc = await db.collection('snapshots').findOne({ site, path, deviceType })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (!doc) {
      return sendToWorker(null, refresh ? 'BYPASS' : 'MISS')
    }

    const { sharedExpires, privateExpires, lock } = doc

    if (lock) {
      try {
        doc = await poll(site, path, deviceType, lock)
        return handleResult(doc, refresh ? 'BYPASS' : privateExpires ? 'EXPIRED' : 'MISS')
      } catch (e) {
        // something went wrong when updating the document.
        // we still use the stale doc.

        // but don't give cache response if 'refresh' param is set.
        if (refresh) {
          throw e
        }
      }
    }

    if (refresh) {
      return sendToWorker(null, 'BYPASS')
    }

    if (privateExpires >= now) {
      return handleResult(doc, 'HIT')
    }

    if (sharedExpires >= now) {
      // refresh cache in background
      if (!lock) {
        sendToWorker(null, null, { noWait: true, callbackURL: null })
      }

      return handleResult(doc, 'UPDATING')
    }

    return sendToWorker(doc, 'EXPIRED')
  }

  function handleResult(doc, cacheStatus) {
    if (doc.status) {
      if (metaOnly) {
        delete doc.html
        delete doc.staticHTML
      }

      if (callbackURL) {
        callback(callbackURL, null, doc, cacheStatus)
      } else if (!noWait) {
        reply(ctx, type, followRedirect, doc, cacheStatus)
      }
    } else {
      throw new RESTError(doc.error)
    }
  }

  function sendToWorker(cacheDoc, cacheStatus, options = {}) {
    options = { noWait, callbackURL, ...options }

    return new Promise((resolve, reject) => {
      if (metaOnly) {
        delete cacheDoc.html
        delete cacheDoc.staticHTML
      }

      const msg = {
        site,
        path,
        deviceType,
        callbackURL: options.callbackURL,
        metaOnly,
        cacheDoc,
        cacheStatus
      }

      let topic
      if (options.callbackURL || options.noWait) {
        topic = 'kasha-async-queue'
      } else {
        topic = 'kasha-sync-queue'
        msg.replyTo = replyTo
        msg.correlationId = uid()
      }

      nsqWriter.publish(topic, msg, e => {
        if (e) {
          const { timestamp, eventId } = logger.error(e)
          reject(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        } else {
          if (options.callbackURL || options.noWait) {
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
