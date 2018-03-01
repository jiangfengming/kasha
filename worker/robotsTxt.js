const { URL } = require('url')
const fetch = require('node-fetch')
const through = require('through')
const parse = require('robots-txt-parse')
const guard = require('robots-txt-guard')
const CustomError = require('../shared/CustomError')
const logger = require('../shared/logger')

const { db } = require('../shared/db')
const collection = db.collection('robotsTxt')
/*
robotsTxt collection schema:
site: String
status: Number
content: String
fullAllow: Boolean
fullDisallow: Boolean
error: String
tried: Number
expire: Date
lock: String
*/

const EXPIRE = 24 * 60 * 60 * 1000 // cache one day
const ERROR_EXPIRE = 60 * 1000 // one minute
const FETCH_TIMEOUT = 10 * 1000


async function doc2result({ content, fullAllow, fullDisallow, error }) {
  if (error) throw new CustomError(JSON.parse(error))
  else return { content, fullAllow, fullDisallow }
}

async function fetchRobotsTxt(site) {
  const url = site + '/robots.txt'
  const now = Date.now()

  let cache
  try {
    cache = await collection.findOne({ site })
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }

  if (cache) {
    if (cache.lock) {
      return new Promise((resolve, reject) => {
        let tried = 0

        const intervalId = setInterval(async() => {
          tried++

          const pollingResult = collection.findOne({ site })
          if (!pollingResult.lock) {
            clearInterval(intervalId)
            resolve(doc2result(pollingResult))
          } else if (tried >= 5) {
            clearInterval(intervalId)

            const error = new CustomError('SERVER_CACHE_LOCK_TIMEOUT', 'robots.txt')

            if (pollingResult.lock === cache.lock) {
              try {
                await collection.updateOne({
                  site,
                  lock: cache.lock
                }, {
                  $set: {
                    error: JSON.stringify(error),
                    expire: new Date(now + ERROR_EXPIRE),
                    lock: false
                  }
                })

                reject(error)
              } catch (e) {
                const { timestamp, eventId } = logger.error(e)
                reject(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
              }
            }
          }
        }, 2000)
      })
    } else if (!cache.error && cache.expire >= now) {
      return doc2result(cache)
    } else if (cache.error && cache.expire > now && cache.tried >= 3) {
      throw new CustomError(
        'SERVER_NET_ERROR',
        `Fetching ${url} failed 3 times in one minute.`
      )
    } else {
      return _fetch()
    }
  } else {
    return _fetch()
  }

  async function _fetch() {
    const lock = uid()

    try {
      await collection.updateOne({
          site,
          $or: [
            error: { $ne: null },
            date:
          ],
          lock: false
        }, {
          $set: {
            status: null,
            content: null,
            fullAllow: null,
            fullDisallow: null,
            error: null,
            expire: new Date(),
            lock
          },
          $setOnInsert: {
            tried: 0
          }
        },
        { upsert: true }
      )
    }
    let res
    try {
      res = await fetch(url, { follow: 5, timeout: FETCH_TIMEOUT })
    } catch (e) {
      try {
        await collection.updateOne({ site }, {
          $set: {
            status: null,
            content: null,
            expire: new Date(now + ERROR_EXPIRE),
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
            expire: new Date(now + ERROR_EXPIRE),
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
  const { origin, pathname } = new URL(url)
  const robotsTxt = await fetchRobotsTxt(origin)
  if (robotsTxt.fullAllow) return true
  if (robotsTxt.fullDisallow) return false
  try {
    const content = through()
    const promise = parse(content).then(rules => guard(rules).isAllowed('kasha', pathname))
    content.end(robotsTxt.content)
    return await promise
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }
}

module.exports = { fetch: fetchRobotsTxt, isAllowed }
