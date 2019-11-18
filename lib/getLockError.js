const cuuid = require('cuuid')
const mongo = require('./mongo')
const RESTError = require('./RESTError')
const logger = require('./logger')

async function getLockError(site, path, profile, lock, updatedAt) {
  if (lock && Date.now() - updatedAt > 20 * 1000) {
    // other worker hasn't refreshed the cache in 20 secs
    // remove the lock and return CACHE_LOCK_TIMEOUT
    let error = new RESTError('CACHE_LOCK_TIMEOUT', 'snapshot')

    try {
      await mongo.db.collection('snapshots').updateOne({
        site,
        path,
        profile,
        lock
      }, {
        $set: {
          error: error.toJSON(),
          updatedAt: new Date(),
          lock: null
        }
      })
    } catch (err) {
      const id = cuuid()
      logger.error({ err, id })
      error = new RESTError('INTERNAL_ERROR', id)
    }

    return error
  } else {
    return false
  }
}

module.exports = getLockError
