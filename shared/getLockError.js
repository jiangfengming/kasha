const { db } = require('./mongo')
const RESTError = require('./RESTError')
const logger = require('./logger')

async function getLockError(site, path, deviceType, lock, updatedAt) {
  if (lock && Date.now() - updatedAt > 25 * 1000) {
    // other process hasn't refreshed the cache in 25 secs
    // remove the lock
    let error = new RESTError('SERVER_CACHE_LOCK_TIMEOUT', 'snapshot')

    try {
      await db.collection('snapshots').updateOne({
        site,
        path,
        deviceType,
        lock
      }, {
        $set: {
          error: error.toJSON(),
          updatedAt: new Date(),
          lock: null
        }
      })
    } catch (e) {
      const { timestamp, eventId } = logger.error(e)
      error = new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId)
    }

    return error
  } else {
    return false
  }
}

module.exports = getLockError
