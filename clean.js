const { CronJob } = require('cron')
const moment = require('moment')
const config = require('./shared/config')
const mongo = require('./shared/mongo')
const logger = require('./shared/logger')
const cronTime = config.cache.autoClean

let db, metaColl, snapshotColl
async function connectDB() {
  db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
  metaColl = db.collection('meta')
  snapshotColl = db.collection('snapshots')
}

function getInfo() {
  return metaColl.findOne({ key: 'cacheClean' })
}

async function setupCron() {
  logger.info('Setting up auto clean cron job...')

  await connectDB()
  const info = await getInfo()

  let nextAt = info.nextAt
  if (info.cronTime !== cronTime || (info.nextAt && info.nextAt < Date.now())) {
    nextAt = nextDate()
    await metaColl.updateOne({ key: 'cacheClean' }, {
      $set: { cronTime, nextAt }
    })

    if (!cronTime) {
      logger.info('Auto clean cron job removed.')
    }
  }

  if (nextAt) {
    setTimer(nextAt)
    logger.info('Auto clean cron job set up.')
  }
}

let cronTimer
let cronPromise = Promise.resolve()
// nextAt: Date | Moment
function setTimer(nextAt) {
  if (!nextAt) return

  const timeout = nextAt - Date.now()
  cronTimer = setTimeout(() => {
    cronPromise = clean(nextAt)
  }, timeout)
  logger.info(`Cache auto clean will start at ${moment(nextAt).format()}`)
}

async function stopCron() {
  if (!cronTime) return

  logger.info('Stopping auto clean cron job...')
  if (cronTimer) {
    clearTimeout(cronTimer)
  }

  await cronPromise
  logger.info('Auto clean cron job stopped.')
}

function nextDate() {
  if (!cronTime) return null

  const job = new CronJob(cronTime, () => { /* nop */ })

  // nextDates() returns an array of Moment objects
  // https://momentjs.com/docs/
  return job.nextDates(1)[0].toDate()
}

async function clean(schedule) {
  const query = {
    key: 'cacheClean',
    cleaning: false
  }

  const $set = {
    cleaning: true,
    cleaningAt: new Date()
  }

  if (schedule) {
    query.nextAt = schedule
    $set.nextAt = nextDate()
  }

  const result = await metaColl.updateOne(query, { $set })

  if (!result.modifiedCount) {
    const info = await getInfo()
    const cleaningAt = moment(info.cleaningAt)
    if (info.cleaning) {
      logger.warn(`The last cleaning job at ${cleaningAt.format()} hasn't finished yet.`)
    } else {
      logger.info(`The last cleaning job at ${cleaningAt.format()} has just finished, no need to clean again.`)
    }

    if (schedule && info.nextAt) {
      let nextAt = info.nextAt
      if (info.nextAt < Date.now()) {
        nextAt = $set.nextAt
        await metaColl.updateOne({ key: 'cacheClean', nextAt: info.nextAt }, { $set: { nextAt } })
      }
      setTimer(nextAt)
    }

    return
  } else {
    try {
      if (schedule) setTimer($set.nextAt)

      logger.info('Cleaning expired snapshots...')
      const startTime = Date.now()
      const result = await snapshotColl.deleteMany({ sharedExpires: { $lt: new Date() } })
      logger.info(`Cleaned ${result.deletedCount} expired snapshots (${((Date.now() - startTime) / 1000).toFixed(3)}s).`)
    } catch (e) {
      throw e
    } finally {
      await metaColl.updateOne({ key: 'cacheClean', cleaning: true }, { $set: { cleaning: false } })
    }
  }
}

async function cli() {
  try {
    await connectDB()
    await clean()
    await mongo.close()
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
}

module.exports = { setupCron, stopCron, cli }
