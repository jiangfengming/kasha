const { URL } = require('url')
const assert = require('assert')
const CustomError = require('../shared/CustomError')
const logger = require('../shared/logger')
const { db } = require('../shared/db')
const { addToQueue, replyTo } = require('./workerResponse')
const uid = require('../shared/uid')
const callback = require('../shared/callback')

const EXPIRE = config.cache * 60 * 1000
const ERROR_EXPIRE = 60 * 1000

const queued = { queued: true }

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop' } = ctx.query
  let { url, callbackUrl, proxy, noWait, metaOnly, followRedirect, ignoreRobotsTxt, refresh } = ctx.query

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

  if (![undefined, ''].includes(ignoreRobotsTxt)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'ignoreRobotsTxt')
  } else {
    ignoreRobotsTxt = ignoreRobotsTxt === ''
  }

  if (![undefined, ''].includes(followRedirect)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'followRedirect')
  } else {
    followRedirect = followRedirect === ''
  }

  if (![undefined, ''].includes(refresh)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'refresh')
  } else {
    refresh = refresh === ''
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
    // to refresh the page, we make the cache expire.
    if (refresh) {
      try {
        await db.collection('snapshot').updateOne({
          site,
          path,
          deviceType,
          lock: false
        }, {
          $set: {
            date: new Date(0)
          }
        })

        await db.collection('robotsTxt').updateOne({ site }, { $set: { expire: new Date(0) } })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      return sendToWorker()
    } else {
      let snapshot
      try {
        snapshot = await db.collection('snapshot').findOne({ site, path, deviceType })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      if (!snapshot) return sendToWorker()

      const { allowCrawl, status, redirect, title, content, error, date, retry, locked } = snapshot

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
        // disable crawling
        if (!allowCrawl && !ignoreRobotsTxt) {
          throw new CustomError('SERVER_ROBOTS_DISALLOW')
        }

        if (content === null && followRedirect) {
          return sendToWorker()
        }

        if (proxy) {
          if (redirect && !followRedirect) {
            ctx.status = status
            ctx.redirect(redirect)
          } else {
            ctx.status = status
            ctx.body = content
          }
        } else {
          const body = {
            url,
            deviceType,
            status,
            redirect,
            title,
            content: metaOnly ? null : content,
            date
          }

          if (callbackUrl) {
            callback(callbackUrl, body)
            ctx.body = queued
          } else if (!noWait) {
            ctx.body = body
          }
        }
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
      site,
      path,
      deviceType,
      callbackUrl,
      metaOnly,
      followRedirect,
      ignoreRobotsTxt
    }))

    let worker, msgOpts
    if (callbackUrl || noWait) {
      worker = 'renderWorker'
      msgOpts = {
        persistent: true
      }
    } else {
      worker = 'renderWorkerRPC'
      msgOpts = {
        correlationId: uid(),
        replyTo: mq.queue.queue
      }
    }

    msgOpts.contentType = 'application/json'

    try {
      if (!await sendToQueue(worker, msg, msgOpts)) {
        logger.warn('Message channel\'s buffer is full')
      }
    } catch (e) {
      logger.error(e)
    }


    if (callbackUrl) {
      ctx.body = queued // end
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
    ctx.body = queued
    handler()
  } else {
    return handler()
  }
}

module.exports = render
