const config = require('./shared/config')
const logger = require('./shared/logger')
const mongo = require('./shared/mongo')

;(async() => {
  try {
    const db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)

    logger.info('Cleanning...')
    const result = await db.collection('snapshots').deleteMany({ sharedExpires: { $lt: new Date() } })
    logger.info(`Cleaned ${result.deletedCount} expired snapshots`)

    await mongo.close()
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
})()
