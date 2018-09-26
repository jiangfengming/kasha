const RESTError = require('./RESTError')
const logger = require('./logger')
const { db } = require('./mongo')
const collection = db.collection('snapshots')

function poll(site, path, deviceType, lock) {
  return new Promise((resolve, reject) => {
    let tried = 0

    async function p() {
      logger.debug(`polling ${site}${path}. lock: ${lock}`)

      tried++

      let doc
      try {
        doc = await collection.findOne({ site, path, deviceType })
      } catch (e) {
        clearInterval(intervalId)
        const { timestamp, eventId } = logger.error(e)
        return reject(new RESTError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      if (!doc.lock || (lock && lock !== doc.lock)) {
        clearInterval(intervalId)
        resolve(doc)
      } else {
        if (!lock) lock = doc.lock

        if (tried > 5) {
          clearInterval(intervalId)

          const error = new RESTError('SERVER_CACHE_LOCK_TIMEOUT', 'snapshot')

          // if the same lock lasts 25s, the other worker may went wrong
          // we remove the lock
          collection.updateOne({
            site,
            path,
            deviceType,
            lock
          }, {
            $set: {
              error: error.toJSON(),
              updatedAt: new Date(),
              lock: false
            }
          }).catch(e => {
            logger.error(e)
          })

          reject(error)
        }
      }
    }

    const intervalId = setInterval(p, 5000)
    if (!lock) p()
  })
}

module.exports = poll
