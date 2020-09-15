const cuuid = require('cuuid')
const RESTError = require('./RESTError')
const logger = require('./logger')
const mongo = require('./mongo')
const getLockError = require('./getLockError')

function poll(site, path, profile, lock) {
  return new Promise((resolve, reject) => {
    const intervalId = setInterval(async() => {
      logger.debug(`polling ${site}${path}. lock: ${lock}`)

      let doc

      try {
        doc = await mongo.db.collection('snapshots').findOne({ site, path, profile })
      } catch (err) {
        clearInterval(intervalId)
        const id = cuuid()
        logger.error({ err, id })
        return reject(new RESTError('INTERNAL_ERROR', id))
      }

      if (!doc) {
        clearInterval(intervalId)
        return reject(new RESTError('DOC_DELETED'))
      }

      if (!doc.lock || (lock && lock !== doc.lock)) {
        // lock removed or changed
        clearInterval(intervalId)

        if (doc.status) {
          return resolve(doc)
        } else {
          return reject(new RESTError('WORKER_TIMEOUT'))
        }
      } else {
        if (!lock) {
          lock = doc.lock
        }

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
