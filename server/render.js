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
  const { deviceType = 'desktop', type = 'html', callbackUrl } = ctx.query
  let { url, noWait, metaOnly, followRedirect, ignoreRobotsTxt, refresh } = ctx.query

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

  if ((callbackUrl || metaOnly) && type !== 'json') {
    throw new CustomError(
      'CLIENT_INVALID_PARAM',
      'callbackUrl and metaOnly can only used with type=json'
    )
  }

  if (noWait && (callbackUrl || metaOnly || ctx.query.type)) {
    throw new CustomError(
      'CLIENT_INVALID_PARAM',
      'noWait can\'t be used with callbackUrl | metaOnly | type'
    )
  }

  logger.debug(ctx.url, {
    extra: {
      params: { url, deviceType, callbackUrl, type, noWait, metaOnly, followRedirect }
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
      doc = await db.collection('snapshots').findOne({ site, path, deviceType })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    if (!doc) return sendToWorker()

    const { error, times, date, expires, lock } = doc

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
      if (expires.getTime() >= now) {
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

  function handleResult({ status, redirect, meta, openGraph, links, html, staticHTML, error, date }) {
    // has error
    if (error) {
      throw new CustomError(JSON.parse(error))
    }

    reply(ctx, type, followRedirect, {
      url,
      deviceType,
      status,
      redirect,
      meta,
      openGraph,
      links,
      html: metaOnly ? undefined : html,
      staticHTML: metaOnly ? undefined : staticHTML,
      date
    })
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
