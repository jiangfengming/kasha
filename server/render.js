const { URL } = require('url')
const assert = require('assert')
const http = require('http')
const https = require('https')
const workerResponder = require('./workerResponder')
const nsqWriter = require('../lib/nsqWriter')
const reply = require('./reply')
const RESTError = require('../lib/RESTError')
const logger = require('../lib/logger')
const mergeSetting = require('./mergeSetting')
const { db } = require('../lib/mongo')
const uid = require('../lib/uid')
const callback = require('../lib/callback')
const poll = require('../lib/poll')
const normalizeDoc = require('../lib/normalizeDoc')
const urlRewrite = require('url-rewrite/es6')
const inArray = require('./inArray')
const getLockError = require('../lib/getLockError')

async function render(ctx) {
  const now = Date.now()
  const { callbackURL } = ctx.state.params
  let { url, type = 'json', profile = '', noWait, metaOnly, followRedirect, refresh } = ctx.state.params

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

  if ((callbackURL || metaOnly) && type !== 'json') {
    type = 'json'
  }

  if (!profile && ctx.state.config.defaultProfile) {
    profile = ctx.state.config.defaultProfile
  }

  let settings
  if (profile) {
    if (!ctx.state.config.profiles || !ctx.state.config.profiles[profile]) {
      throw new RESTError('INVALID_PARAM', 'profile')
    } else {
      settings = ctx.state.config.profiles[profile]
    }
  }

  let {
    keepQueries = true,
    keepHash = true,
    rewrites = null,
    excludes = null,
    includes = null,
    userAgent = null
  } = ctx.state.config

  if (settings) {
    keepQueries = mergeSetting(keepQueries, settings.keepQueries)
    rewrites = mergeSetting(rewrites, settings.rewrites)
    excludes = mergeSetting(excludes, settings.excludes)
    includes = mergeSetting(includes, settings.includes)

    if (settings.keepHash !== undefined) {
      keepHash = settings.keepHash
    }

    if (settings.userAgent) {
      userAgent = settings.userAgent
    }
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
    if (keepQueries) {
      if (keepQueries.constructor === Array) {
        const matched = keepQueries.find(([rule]) =>
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

    logger.debug({ site, path, profile, callbackURL, type, noWait, metaOnly, followRedirect })

    if (excludes) {
      let exclude
      if (includes && inArray(includes, url.pathname)) {
        exclude = false
      }

      if (exclude === undefined) {
        exclude = inArray(excludes, url.pathname)
      }

      if (exclude) {
        if (rewrites) {
          let rewrited
          try {
            rewrited = urlRewrite(url, rewrites, true)
          } catch (e) {
            throw new RESTError('URL_REWRITE_ERROR', url.href)
          }

          if (!rewrited) {
            throw new RESTError('NOT_FOUND')
          }

          return new Promise((resolve, reject) => {
            const _http = rewrited.protocol === 'http:' ? http : https
            const req = _http.request(rewrited.href, res => {
              delete res.headers.connection
              delete res.headers['keep-alive']
              if (res.headers['content-type'] && res.headers['content-type'].includes('text/html')) {
                delete res.headers['content-disposition']
              }
              ctx.status = res.statusCode
              ctx.set(res.headers)
              ctx.body = res
              resolve()
            })

            req.on('error', e => reject(new RESTError('FETCH_ERROR', rewrited.href, e.message)))
            req.end()
          })
        }
      }
    }

    let doc

    try {
      doc = await db.collection('snapshots').findOne({ site, path, profile })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new RESTError('INTERNAL_ERROR', timestamp, eventId)
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

    if (!refresh && doc.status) {
      if (doc.privateExpires >= now) {
        return handleResult(doc, 'HIT')
      }

      if (doc.sharedExpires >= now) {
        if (!doc.lock) {
          // refresh the cache in background
          sendToWorker(null, { noWait: true, callbackURL: null })
        }

        return handleResult(doc, doc.error ? 'STALE' : 'UPDATING')
      }
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
        rewrites: rewrites ?
          rewrites.map(
            ([search, replace]) =>
              search.constructor === RegExp ? ['regexp', search.toString(), replace] : ['string', search, replace]
          )
          : null,
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
