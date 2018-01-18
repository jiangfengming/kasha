const { URL } = require('url')
const fetch = require('node-fetch')
const through = require('through')
const parse = require('robots-txt-parse')
const guard = require('robots-txt-guard')

const EXPIRE = 24 * 60 * 60 * 1000 // cache one day

/*
robotsTxt collection schema:
site: string,
status: int,
content: string,
expire: date,
fullAllow: boolean,
fullDisallow: boolean,
error: string
*/

async function fetchRobotsTxt(site) {
  const url = site + '/robots.txt'
  const collection = db.collection('robotsTxt')
  const now = Date.now()

  let cache
  try {
    cache = await collection.findOne({ site })
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }

  if (cache) {
    const { status, content, expire, fullAllow, fullDisallow, error, retry } = cache
    if (status && (status >= 200 && status <= 299 || status >= 400 && status <= 499)) {
      if (expire < now) { // refresh
        _fetch().catch(() => { /* nop */ })
      }

      return { content, fullAllow, fullDisallow }
    } else if (retry >= 3) {
      throw new CustomError(
        'SERVER_NET_ERROR',
        `Fetching ${url} failed 3 times in one minute (${error || ('HTTP ' + status)}).`
      )
    } else {
      return _fetch()
    }
  } else {
    return _fetch()
  }

  async function _fetch() {
    let res
    try {
      res = await fetch(url, { follow: 5 })
    } catch (e) {
      try {
        await collection.updateOne({ site }, {
          $set: {
            status: null,
            content: null,
            expire: new Date(now + 60 * 1000),
            fullAllow: null,
            fullDisallow: null,
            error: e.message
          },
          $inc: {
            retry: 1
          }
        })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      throw new CustomError('SERVER_NET_ERROR', e.message)
    }

    let maxAge
    const cacheControl = res.headers.get('Cache-Control')
    if (cacheControl) maxAge = cacheControl.match(/(?:^|,)\s*max-age=(\d+)/)
    maxAge = maxAge ? maxAge[1] * 1000 : EXPIRE
    const expire = new Date(now + maxAge)

    const contentType = res.headers.get('Content-Type')

    if (res.ok && contentType.startsWith('text/plain')) {
      const content = await res.text()
      try {
        await collection.updateOne({ site }, {
          $set: {
            status: res.status,
            content,
            expire,
            fullAllow: false,
            fullDisallow: false,
            error: null,
            retry: 0
          }
        }, { upsert: true })
        return { content, fullAllow: false, fullDisallow: false }
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }
    } else {
      const content = null
      let update
      let fullAllow = false
      let fullDisallow = false

      if (res.status >= 400 && res.status <= 499 || res.ok && !contentType.startsWith('text/plain')) {
        fullAllow = true
        update = {
          $set: {
            status: res.status,
            content,
            expire,
            fullAllow,
            fullDisallow,
            error: null,
            retry: 0
          }
        }
      } else {
        fullDisallow = true
        update = {
          $set: {
            status: res.status,
            content,
            expire: new Date(now + 60 * 1000),
            fullAllow,
            fullDisallow,
            error: null
          },
          $inc: {
            retry: 1
          }
        }
      }

      try {
        await collection.updateOne({ site }, update, { upsert: true })
        return { content, fullAllow, fullDisallow }
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }
    }
  }
}

async function isAllowed(url) {
  url = new URL(url)
  const robotsTxt = await fetchRobotsTxt(url.origin)
  if (robotsTxt.fullAllow) return true
  if (robotsTxt.fullDisallow) return false
  const content = through()
  content.end(robotsTxt.content)
  const rules = await parse(content)
  return guard(rules).isAllowed('*', url.pathname)
}

module.exports = { fetch: fetchRobotsTxt, isAllowed }
