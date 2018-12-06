const { db } = require('./mongo')
const RESTError = require('./RESTError')
const logger = require('./logger')

function getLockError(site, path, deviceType, lock, updatedAt) {
  if (lock && Date.now() - updatedAt > 25 * 1000) {
    // other process hasn't refreshed the cache in 25 secs
    // remove the lock
    const error = new RESTError('SERVER_CACHE_LOCK_TIMEOUT', 'snapshot')
    db.collection('snapshots').updateOne({
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
    }).catch(e => {
      logger.error(e)
    })

    return error
  } else {
    return false
  }
}

module.exports = getLockError
