const { URL } = require('url')
const assert = require('assert')
const urlRewrite = require('url-rewrite/es6')
const nsqWriter = require('../lib/nsqWriter')
const RESTError = require('../lib/RESTError')
const logger = require('../lib/logger')
const mongo = require('../lib/mongo')
const uid = require('../lib/uid')
const callback = require('../lib/callback')
const poll = require('../lib/poll')
const normalizeDoc = require('../lib/normalizeDoc')
const rewriteRuleParser = require('../lib/rewriteRuleParser')
const getLockError = require('../lib/getLockError')
const validHTTPStatus = require('../lib/validHTTPStatus')
const inArray = require('./inArray')
const workerResponder = require('./workerResponder')
const reply = require('./reply')
const mergeSetting = require('./mergeSetting')
const proxy = require('./proxy')

async function render(ctx) {
  const now = Date.now()
  const { callbackURL } = ctx.state.params
  let { url, type = 'json', profile = '', noWait, metaOnly, followRedirect, refresh, fallback } = ctx.state.params

  try {
    // mongodb index size must be less than 1024 bytes (includes structural overhead)
    assert(Buffer.byteLength(url) <= 896)
    url = new URL(url)
    assert(['http:', 'https:'].includes(url.protocol))
  } catch (e) {
    throw new RESTError('INVALID_PARAM', 'url')
  }

  if (callbackURL) {
    try {
      assert(['http:', 'https:'].includes(new URL(callbackURL).protocol))
    } catch (e) {
      throw new RESTError('INVALID_PARAM', 'callbackURL')
    }
  }

  const validValues = [undefined, '', '0', '1']
  const truthyValues = ['', '1']

  if (!['html', 'static', 'json'].includes(type)) {
    throw new RESTError('INVALID_PARAM', 'type')
  }

  if (!validValues.includes(noWait)) {
    throw new RESTError('INVALID_PARAM', 'noWait')
  } else {
    noWait = truthyValues.includes(noWait)
  }

  if (!validValues.includes(metaOnly)) {
    throw new RESTError('INVALID_PARAM', 'metaOnly')
  } else {
    metaOnly = truthyValues.includes(metaOnly)
  }

  if (!validValues.includes(followRedirect)) {
    throw new RESTError('INVALID_PARAM', 'followRedirect')
  } else {
    followRedirect = truthyValues.includes(followRedirect)
  }

  if (!validValues.includes(refresh)) {
    throw new RESTError('INVALID_PARAM', 'refresh')
  } else {
    refresh = truthyValues.includes(refresh)
  }

  if (!validValues.includes(fallback)) {
    throw new RESTError('INVALID_PARAM', 'fallback')
  } else {
    fallback = truthyValues.includes(fallback)
  }

  if ((callbackURL || metaOnly) && type !== 'json') {
    type = 'json'
  }

  if (!profile && ctx.state.site.defaultProfile) {
    profile = ctx.state.site.defaultProfile
  }

  let settings

  if (profile) {
    if (!ctx.state.site.profiles || !ctx.state.site.profiles[profile]) {
      throw new RESTError('INVALID_PARAM', 'profile')
    } else {
      settings = ctx.state.site.profiles[profile]
    }
  }

  let {
    keepQuery = true,
    keepHash = true,
    rewrites = null,
    excludes = null,
    includes = null,
    userAgent = null,
    serviceUnavailable = null
  } = ctx.state.site

  if (settings) {
    keepQuery = mergeSetting(keepQuery, settings.keepQuery)
    rewrites = mergeSetting(rewrites, settings.rewrites)
    excludes = mergeSetting(excludes, settings.excludes)
    includes = mergeSetting(includes, settings.includes)
    serviceUnavailable = settings.serviceUnavailable

    if (settings.keepHash !== undefined) {
      keepHash = settings.keepHash
    }

    if (settings.userAgent) {
      userAgent = settings.userAgent
    }
  }

  serviceUnavailable = Boolean(serviceUnavailable && serviceUnavailable.getTime() + 10 * 1000 > now)

  if (serviceUnavailable) {
    fallback = false
  }

  const site = url.origin
  let path

  if (noWait || callbackURL) {
    ctx.body = { queued: true }

    // don't let handler() block the request
    handler().catch(e => {
      if (callbackURL) {
        callback(callbackURL, e)
      }
    })
  } else {
    return handler()
  }

  async function handler() {
    if (keepQuery) {
      if (keepQuery.constructor === Array) {
        const matched = keepQuery.find(([rule]) =>
          rule instanceof RegExp ? rule.test(url.pathname) : rule === url.pathname
        )

        if (matched) {
          const whitelist = matched.slice(1)

          for (const [q] of url.searchParams) {
            if (!whitelist.includes(q)) {
              url.searchParams.delete(q)
            }
          }

          url.searchParams.sort()
        } else {
          url.search = ''
        }
      } else {
        url.searchParams.sort()
      }
    } else {
      url.search = ''
    }

    if (!keepHash) {
      url.hash = ''
    }

    path = url.pathname + url.search + url.hash

    logger.debug({ site, path, profile, refresh, fallback, type, noWait, metaOnly, followRedirect, callbackURL })

    let rewrited = url

    if (rewrites) {
      try {
        rewrited = urlRewrite(url, rewrites, true)
      } catch (e) {
        throw new RESTError('URL_REWRITE_ERROR', url.href)
      }

      if (!rewrited) {
        throw new RESTError('NOT_FOUND')
      }
    }

    if (excludes) {
      let excluded

      if (includes && inArray(includes, url.pathname)) {
        excluded = false
      }

      if (excluded === undefined) {
        excluded = inArray(excludes, url.pathname)
      }

      if (excluded) {
        try {
          return await proxy(ctx, rewrited)
        } catch (e) {
          throw new RESTError('FETCH_ERROR', rewrited.href, e.message)
        }
      }
    }

    let doc

    try {
      doc = await mongo.db.collection('snapshots').findOne({ site, path, profile })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new RESTError('INTERNAL_ERROR', timestamp, eventId)
    }

    if (fallback && (!doc || !validHTTPStatus.includes(doc.status) || doc.privateExpires < now)) {
      try {
        noWait = true
        await proxy(ctx, rewrited)
        ctx.set('Cache-Control', 'max-age=10')
        ctx.set('Vary', 'Kasha-Profile, Kasha-Fallback')
        ctx.remove('Expires')
      } catch (e) {
        throw new RESTError('FETCH_ERROR', rewrited.href, e.message)
      }
    }

    if (!doc) {
      return sendToWorker(refresh ? 'BYPASS' : 'MISS')
    }

    if (doc.lock) {
      const lockError = await getLockError(site, path, profile, doc.lock, doc.updatedAt)

      if (lockError && lockError.code === 'CACHE_LOCK_TIMEOUT') {
        doc.lock = null
      }
    }

    if (refresh && !doc.lock) {
      return sendToWorker('BYPASS')
    }

    if (!refresh && doc.status && (doc.sharedExpires >= now || serviceUnavailable)) {
      // refresh the cache in background
      if (!serviceUnavailable && !doc.lock && (doc.privateExpires < now + 10 * 1000 || doc.sharedExpires < now)) {
        sendToWorker(null, { noWait: true, callbackURL: null })
      }

      return handleResult(doc, doc.privateExpires >= now ? 'HIT' : doc.error ? 'STALE' : 'UPDATING')
    }

    if (doc.lock) {
      const status = doc.status
      try {
        doc = await poll(site, path, profile, doc.lock)
        return handleResult(doc, refresh ? 'BYPASS' : status ? 'EXPIRED' : 'MISS')
      } catch (e) {
        // something went wrong when updating the document.
        // we still use the stale doc if available unless `refresh` param is set.
        if (doc.status && !refresh) {
          return handleResult(doc, doc.privateExpires && doc.privateExpires >= now ? 'HIT' : 'STALE')
        } else {
          throw e
        }
      }
    }

    return sendToWorker(doc.status ? 'EXPIRED' : 'MISS')
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
        profile,
        userAgent,
        rewrites: rewriteRuleParser.escape(rewrites),
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
          reject(new RESTError('INTERNAL_ERROR', timestamp, eventId))
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
