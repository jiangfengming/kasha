const { URL } = require('url')
const fetch = require('node-fetch')
const through = require('through')
const parse = require('robots-txt-parse')
const guard = require('robots-txt-guard')
const CustomError = require('../shared/CustomError')
const logger = require('../shared/logger')
const uid = require('../shared/uid')

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
times: Number
date: Date
lock: String
*/

const EXPIRE = 24 * 60 * 60 * 1000 // cache one day
const ERROR_EXPIRE = 60 * 1000 // one minute
const FETCH_TIMEOUT = 9 * 1000


async function fetchRobotsTxt(site) {
  const url = site + '/robots.txt'

  let cache
  try {
    cache = await collection.findOne({ site })
  } catch (e) {
    const { timestamp, eventId } = logger.error(e)
    throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
  }

  if (!cache) return _fetch()

  if (cache.lock) return poll(cache.lock)

  if (!cache.error && cache.date.getTime() + EXPIRE >= Date.now()) return doc2result(cache)

  if (cache.error && cache.date.getTime() + ERROR_EXPIRE > Date.now() && cache.times % 4 === 3) {
    throw new CustomError(
      'SERVER_NET_ERROR',
      `Fetching ${url} failed 3 times in one minute.`
    )
  }

  return _fetch()

  async function doc2result({ content, fullAllow, fullDisallow, error }) {
    if (error) throw new CustomError(JSON.parse(error))
    else return { content, fullAllow, fullDisallow }
  }

  function poll(lock) {
    return new Promise((resolve, reject) => {
      let tried = 0

      const intervalId = setInterval(p, 2000)
      if (!lock) p()

      async function p() {
        tried++

        let pollingResult
        try {
          pollingResult = await collection.findOne({ site })
        } catch (e) {
          clearInterval(intervalId)
          const { timestamp, eventId } = logger.error(e)
          return reject(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
        }

        if (!pollingResult.lock) { // unlocked
          clearInterval(intervalId)
          resolve(doc2result(pollingResult))
        } else {
          if (!lock) lock = pollingResult.lock

          if (tried > 5) {
            clearInterval(intervalId)

            const error = new CustomError('SERVER_CACHE_LOCK_TIMEOUT', 'robots.txt')

            // if the same lock lasts 10s, the other worker may went wrong
            // we remove the lock
            if (lock === pollingResult.lock) {
              try {
                await collection.updateOne({
                  site,
                  lock
                }, {
                  $set: {
                    error: JSON.stringify(error),
                    date: new Date(),
                    lock: false
                  },
                  $inc: {
                    times: 1
                  }
                })
              } catch (e) {
                const { timestamp, eventId } = logger.error(e)
                return reject(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
              }
            }

            reject(error)
          }
        }
      }
    })
  }

  async function _fetch() {
    const lock = uid()

    try {
      await collection.updateOne({
        site,
        lock: false,
        $or: [
          { error: { $ne: null } }, // error
          { date: { $lt: new Date(Date.now() - EXPIRE) } } // expired
        ]
      }, {
        $set: {
          status: null,
          content: null,
          fullAllow: null,
          fullDisallow: null,
          error: null,
          date: new Date(),
          lock
        },
        $setOnInsert: {
          times: 0
        }
      }, { upsert: true })
    } catch (e) {
      if (e.code !== 11000) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      return poll()
    }

    let res
    try {
      res = await fetch(url, { follow: 5, timeout: FETCH_TIMEOUT })
    } catch (e) {
      const error = new CustomError('SERVER_NET_ERROR', e.message)

      try {
        await collection.updateOne({ site }, {
          $set: {
            status: null,
            content: null,
            expire: new Date(Date.now() + ERROR_EXPIRE),
            fullAllow: null,
            fullDisallow: null,
            error: JSON.stringify(error)
          },
          $inc: {
            times: 1
          }
        })
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        throw new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      throw error
    }

    const contentType = res.headers.get('Content-Type')

    if (res.ok && contentType.startsWith('text/plain')) {
      const content = await res.text()
      try {
        await collection.updateOne({ site }, {
          $set: {
            status: res.status,
            content,
            fullAllow: false,
            fullDisallow: false,
            error: null,
            date: new Date()
          },
          $inc: {
            times: 1
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
            fullAllow,
            fullDisallow,
            error: null,
            date: new Date()
          },
          $inc: {
            times: 1
          }
        }
      } else {
        fullDisallow = true
        update = {
          $set: {
            status: res.status,
            content,
            fullAllow,
            fullDisallow,
            error: null,
            date: new Date()
          },
          $inc: {
            times: 1
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
