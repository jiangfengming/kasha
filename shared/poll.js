const RESTError = require('./RESTError')
const logger = require('./logger')
const { db } = require('./mongo')
const getLockError = require('./getLockError')

function poll(site, path, profile, lock) {
  return new Promise((resolve, reject) => {
    const intervalId = setInterval(async() => {
      logger.debug(`polling ${site}${path}. lock: ${lock}`)

      let doc
      try {
        doc = await db.collection('snapshots').findOne({ site, path, profile })
      } catch (e) {
        clearInterval(intervalId)
        const { timestamp, eventId } = logger.error(e)
        return reject(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      if (!doc) {
        clearInterval(intervalId)
        return reject(new RESTError('SERVER_DOC_DELETED'))
      }

      if (!doc.lock || (lock && lock !== doc.lock)) {
        // lock removed or changed
        clearInterval(intervalId)
        resolve(doc)
      } else {
        if (!lock) lock = doc.lock
        const error = await getLockError(site, path, profile, lock, doc.updatedAt)
        if (error) {
          clearInterval(intervalId)
          reject(error)
        }
      }
    }, 5000)
  })
}

module.exports = poll
