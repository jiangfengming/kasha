const CustomError = require('./CustomError')
const logger = require('./logger')
const { db } = require('./db')
const collection = db.collection('snapshots')

function poll(site, path, deviceType, lock) {
  return new Promise((resolve, reject) => {
    let tried = 0

    async function p() {
      logger.debug('polling ' + site + path)

      tried++

      let doc
      try {
        doc = await collection.findOne({ site, path, deviceType })
      } catch (e) {
        clearInterval(intervalId)
        const { timestamp, eventId } = logger.error(e)
        return reject(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      if (!doc.lock) { // unlocked
        clearInterval(intervalId)
        resolve(doc)
      } else {
        if (!lock) lock = doc.lock

        if (tried > 5) {
          clearInterval(intervalId)

          const error = new CustomError('SERVER_CACHE_LOCK_TIMEOUT', 'snapshot')

          // if the same lock lasts 25s, the other worker may went wrong
          // we remove the lock
          if (lock === doc.lock) {
            try {
              await collection.updateOne({
                site,
                path,
                deviceType,
                lock
              }, {
                $set: {
                  error: JSON.stringify(error),
                  date: new Date(),
                  lock: false
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

    const intervalId = setInterval(p, 5000)
    if (!lock) p()
  })
}

module.exports = poll
