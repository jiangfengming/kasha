const { URL } = require('url')
const assert = require('assert')
const config = require('../shared/config')
const CustomError = require('../shared/CustomError')
const logger = require('../shared/logger')
const { db } = require('../shared/db')
const { writer: nsqWriter } = require('../shared/nsqWriter')
const { addToQueue, replyTo } = require('./workerResponse')
const uid = require('../shared/uid')
const callback = require('../shared/callback')
const poll = require('../shared/poll')

const EXPIRE = config.cache * 60 * 1000
const ERROR_EXPIRE = 60 * 1000

async function render(ctx) {
  const now = Date.now()
  const { deviceType = 'desktop', callbackUrl } = ctx.query
  let { url, proxy, noWait, metaOnly, followRedirect, ignoreRobotsTxt, refresh } = ctx.query

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

  const validValues = [undefined, '', '0', '1']
  const truthyValues = ['', '1']

  if (!validValues.includes(proxy)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'proxy')
  } else {
    proxy = truthyValues.includes(proxy)
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

  if (!validValues.includes(ignoreRobotsTxt)) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'ignoreRobotsTxt')
  } else {
    ignoreRobotsTxt = truthyValues.includes(ignoreRobotsTxt)
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
    // to refresh the page, we make the cache expired.
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

        await db.collection('robotsTxt').updateOne({ site }, {
          $set: {
            date: new Date(0)
          }
        })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      return sendToWorker()
    }

    let doc
    try {
      doc = await db.collection('snapshot').findOne({ site, path, deviceType })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (!doc) return sendToWorker()

    const { error, times, date, lock } = doc

    if (lock) {
      return handleResult(await poll(site, path, deviceType, lock))
    }

    if (error) {
      if (times % 4 === 3 && date.getTime() + ERROR_EXPIRE > now) {
        throw new CustomError(
          'SERVER_RENDER_ERROR',
          `Fetching ${url} failed 3 times in one minute.`
        )
      }

      return sendToWorker()
    } else {
      if (date.getTime() + EXPIRE > now) {
        return handleResult(doc)
      }

      return sendToWorker()
    }
  }

  if (noWait || callbackUrl) {
    ctx.body = { queued: true }
    handler().catch(e => {
      if (callbackUrl) callback(callbackUrl, e)
    })
  } else {
    return handler()
  }

  function handleResult({ allowCrawl, status, redirect, meta, openGraph, content, error, date }) {
    // has error
    if (error) {
      throw new CustomError(JSON.parse(error))
    }

    // disable crawling
    if (!allowCrawl && !ignoreRobotsTxt) {
      throw new CustomError('SERVER_ROBOTS_DISALLOW')
    }

    if (proxy) {
      if (redirect && !followRedirect) {
        ctx.status = status
        ctx.redirect(redirect)
      } else {
        if (!redirect) ctx.status = status
        ctx.body = content
      }
    } else {
      const doc = {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        content: metaOnly ? null : content,
        date
      }

      if (callbackUrl) {
        callback(callbackUrl, null, doc)
      } else if (!noWait) {
        ctx.body = doc
      }
    }
  }

  function sendToWorker() {
    return new Promise((resolve, reject) => {
      const msg = {
        site,
        path,
        deviceType,
        callbackUrl,
        metaOnly,
        followRedirect,
        ignoreRobotsTxt
      }

      let topic
      if (callbackUrl || noWait) {
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
          if (callbackUrl || noWait) {
            resolve()
          } else {
            resolve(addToQueue({
              correlationId: msg.correlationId,
              ctx,
              proxy,
              followRedirect
            }))
          }
        }
      })
    })
  }
}

module.exports = render
