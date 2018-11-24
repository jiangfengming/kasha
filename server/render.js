const { URL } = require('url')
const assert = require('assert')
const http = require('http')
const https = require('https')
const workerResponder = require('./workerResponder')
const nsqWriter = require('../shared/nsqWriter')
const reply = require('./reply')
const RESTError = require('../shared/RESTError')
const logger = require('../shared/logger')
const { db } = require('../shared/mongo')
const getSiteConfig = require('../shared/getSiteConfig')
const uid = require('../shared/uid')
const callback = require('../shared/callback')
const poll = require('../shared/poll')
const normalizeDoc = require('../shared/normalizeDoc')
const urlRewrite = require('../shared/urlRewrite')
const inArray = require('../shared/inArray')

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop', callbackURL } = ctx.query
  let { url, type = 'json', noWait, metaOnly, followRedirect, refresh } = ctx.query

  try {
    // mongodb index size must be less than 1024 bytes (includes structural overhead)
    assert(Buffer.byteLength(url) <= 896)
    url = new URL(url)
    assert(['http:', 'https:'].includes(url.protocol))
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

  const site = url.origin
  let path = url.pathname

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
    if (!ctx.siteConfig) {
      try {
        ctx.siteConfig = await getSiteConfig({ host: url.host, protocol: url.protocol.slice(0, -1) })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }
    }

    if (!ctx.siteConfig || !ctx.siteConfig.removeQueryString) {
      path += url.search
    }

    if (!ctx.siteConfig || !ctx.siteConfig.removeHash) {
      path += url.hash
    }

    logger.debug({ site, path, deviceType, callbackURL, type, noWait, metaOnly, followRedirect })

    if (ctx.siteConfig && ctx.siteConfig.rewrites) {
      let rewrited = urlRewrite(url.href, ctx.siteConfig.rewrites)
      try {
        rewrited = new URL(rewrited)
      } catch (e) {
        throw new RESTError('SERVER_URL_REWRITE_ERROR', rewrited)
      }

      // if pathname neither in includes list, nor in excludes list, then `includes` is true
      let includes
      if (ctx.siteConfig.includes && inArray(ctx.siteConfig.includes, url.pathname)) {
        includes = true
      }

      if (includes === undefined) {
        if (ctx.siteConfig.excludes && inArray(ctx.siteConfig.excludes, url.pathname)) {
          includes = false
        } else {
          includes = true
        }
      }

      if (!includes) {
        return new Promise((resolve, reject) => {
          const _http = rewrited.protocol === 'http' ? http : https
          const req = _http.request(rewrited.href, res => {
            delete res.headers.connection
            if (res.headers['content-type'].includes('text/html')) {
              delete res.headers['content-disposition']
            }
            ctx.set(res.headers)
            ctx.body = res
            resolve()
          })

          req.on('error', e => reject(new RESTError('SERVER_FETCH_ERROR', rewrited.href, e.message)))
          req.end()
        })
      }
    }

    let doc

    try {
      doc = await db.collection('snapshots').findOne({ site, path, deviceType })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (!doc) {
      return sendToWorker(refresh ? 'BYPASS' : 'MISS')
    }

    const { privateExpires, sharedExpires, lock } = doc

    if (refresh) {
      if (!lock) {
        return sendToWorker('BYPASS')
      }
    } else {
      if (privateExpires && privateExpires >= now) {
        return handleResult(doc, 'HIT')
      }

      if (sharedExpires && sharedExpires >= now) {
        // refresh cache in background
        if (!lock) {
          sendToWorker(null, { noWait: true, callbackURL: null })
        }

        return handleResult(doc, doc.error ? 'STALE' : 'UPDATING')
      }
    }

    if (lock) {
      try {
        doc = await poll(site, path, deviceType, lock)
        return handleResult(doc, refresh ? 'BYPASS' : privateExpires ? 'EXPIRED' : 'MISS')
      } catch (e) {
        // something went wrong when updating the document.
        // we still use the stale doc if available.
        // but don't give cache response if 'refresh' param is set.
        if (doc.status || !refresh) {
          return handleResult(doc, privateExpires && privateExpires >= now ? 'HIT' : 'STALE')
        } else {
          throw e
        }
      }
    }

    return sendToWorker('EXPIRED')
  }

  function handleResult(doc, cacheStatus) {
    // don't return the stale document in BYPASS mode, return the last error if there's one.
    if (doc.status && !(doc.error && cacheStatus === 'BYPASS')) {
      doc = normalizeDoc(doc, metaOnly)

      if (callbackURL) {
        callback(callbackURL, null, doc, cacheStatus)
      } else if (!noWait) {
        reply(ctx, type, followRedirect, doc, cacheStatus)
      }
    } else {
      throw new RESTError(doc.error)
    }
  }

  function sendToWorker(cacheStatus, options = {}) {
    options = { noWait, callbackURL, ...options }

    return new Promise((resolve, reject) => {
      const msg = {
        site,
        path,
        deviceType,
        rewrites: ctx.siteConfig && ctx.siteConfig.rewrites
          ? ctx.siteConfig.rewrites.map(
            ([search, replace]) =>
              search.constructor === RegExp ? ['regexp', search.toString(), replace] : ['string', search, replace]
          ) : null,
        callbackURL: options.callbackURL,
        metaOnly,
        cacheStatus
      }

      let topic
      if (options.callbackURL || options.noWait) {
        topic = 'kasha-async-queue'
      } else {
        topic = 'kasha-sync-queue'
        msg.replyTo = workerResponder.topic
        msg.correlationId = uid()
      }

      logger.debug('sendToWorker', topic, msg)
      nsqWriter.writer.publish(topic, msg, e => {
        if (e) {
          const { timestamp, eventId } = logger.error(e)
          reject(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        } else {
          if (options.callbackURL || options.noWait) {
            resolve()
          } else {
            resolve(workerResponder.addToQueue({
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
