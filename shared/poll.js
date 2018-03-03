const CustomError = require('../shared/CustomError')
const logger = require('../shared/logger')
const { db } = require('../db')
const collection = db.collection('snapshot')

function poll(site, path, deviceType, lock) {
  return new Promise((resolve, reject) => {
    const url = site + path
    let tried = 0

    async function poll() {
      tried++

      let pollingResult
      try {
        pollingResult = await collection.findOne({ site, path, deviceType })
      } catch (e) {
        clearInterval(intervalId)
        const { timestamp, eventId } = logger.error(e)
        return reject(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      if (!pollingResult.lock) { // unlocked
        clearInterval(intervalId)
        handleResult(doc2result(pollingResult))
      } else {
        if (!initialLock) initialLock = pollingResult.lock

        if (tried > 5) {
          clearInterval(intervalId)

          const error = new CustomError('SERVER_CACHE_LOCK_TIMEOUT', 'snapshot')

          // if the same lock lasts 25s, the other worker may went wrong
          // we remove the lock
          if (initialLock === pollingResult.lock) {
            try {
              await collection.updateOne({
                site,
                path,
                deviceType,
                lock: initialLock
              }, {
                $set: {
                  error: JSON.stringify(error),
                  date: new Date(),
                  lock: false
                }
              })
            } catch (e) {
              const { timestamp, eventId } = logger.error(e)
              return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
            }
          }

          handleResult(error)
        }
      }
    }

    function doc2result({ status, redirect, title, content, error, date }) {
      return error
        ? new CustomError(JSON.parse(error))
        : {
          url,
          deviceType,
          status,
          redirect,
          title,
          content: metaOnly ? null : content,
          date
        }
    }

    const intervalId = setInterval(polling, 5000)
    polling()
  })
}
