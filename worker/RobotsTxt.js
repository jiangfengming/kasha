const fetch = require('node-fetch')

async function fetchRobotsTxt(site) {
  const url = site + '/robots.txt'
  const collection = db.collection('robotsTxt')

  let cache
  try {
    cache = collection.findOne({ site })
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }

  if (cache && cache.expire < Date.now()) {
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
  const expire = new Date(Date.now() + maxAge ? maxAge[1] * 1000 : 24 * 60 * 60 * 1000)

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
    let update
    if (res.status >= 400 && res.status <= 499) {
      update = { $set: { status: res.status, content: '', expire, fullAllow: true, fullDisallow: false, retry: 0 } }
    } else {
      update = { $set: { status: res.status, content: '', expire: new Date(Date.now() + 60 * 1000), fullAllow: false, fullDisallow: true }, $inc: { retry: 1 } }
    }

    try {
      collection.updateOne({ site }, update, { upsert: true })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }
  }
}

function isAllowed() {

}

module.exports = fetchRobotsTxt
