const { URL } = require('url')
const fetch = require('node-fetch')
const through = require('through')
const parse = require('robots-txt-parse')
const guard = require('robots-txt-guard')

const EXPIRE = 24 * 60 * 60 * 1000 // cache one day

async function fetchRobotsTxt(site) {
  const url = site + '/robots.txt'
  const collection = db.collection('robotsTxt')

  let cache
  try {
    cache = await collection.findOne({ site })
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }

  if (cache && cache.expire > Date.now()) {
    if (cache.status >= 200 && cache.status <= 299 || cache.status >= 400 && cache.status <= 499) {
      return { content: cache.content, fullAllow: cache.fullAllow, fullDisallow: cache.fullDisallow }
    } else if (cache.retry >= 3) {
      throw new CustomError('SERVER_NET_ERROR', `Fetching ${url} failed 3 times in one minute.`)
    }
  }

  let res
  try {
    res = await fetch(url, { follow: 5 })
  } catch (e) {
    throw new CustomError('SERVER_NET_ERROR', e.message)
  }

  let maxAge
  const cacheControl = res.headers.get('Cache-Control')
  if (cacheControl) maxAge = cacheControl.match(/(?:^|,)\s*max-age=(\d+)/)
  maxAge = maxAge ? maxAge[1] * 1000 : EXPIRE
  const expire = new Date(Date.now() + maxAge)

  if (res.ok) {
    const content = await res.text()
    try {
      collection.updateOne({ site }, { $set: { status: res.status, content, expire, fullAllow: false, fullDisallow: false, retry: 0 } }, { upsert: true })
      return { content, fullAllow: false, fullDisallow: false }
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }
  } else {
    const content = ''
    let update
    let fullAllow = false
    let fullDisallow = false

    if (res.status >= 400 && res.status <= 499) {
      fullAllow = true
      update = { $set: { status: res.status, content, expire, fullAllow, fullDisallow, retry: 0 } }
    } else {
      fullDisallow = true
      update = { $set: { status: res.status, content, expire: new Date(Date.now() + 60 * 1000), fullAllow, fullDisallow }, $inc: { retry: 1 } }
    }

    try {
      collection.updateOne({ site }, update, { upsert: true })
      return { content, fullAllow, fullDisallow }
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
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
