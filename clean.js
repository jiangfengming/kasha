const { CronJob } = require('cron')
const moment = require('moment')
const config = require('./shared/config')
const mongo = require('./shared/mongo')
const logger = require('./shared/logger')
const cronTime = config.cache.cacheClean

let db, metaColl, snapshotColl

async function connectDB() {
  db = await mongo.connect()
  metaColl = db.collection('meta')
  snapshotColl = db.collection('snapshots')
}

let timer
let cleaningPromise = Promise.resolve()

async function setupCronJob() {
  if (!cronTime) return

  logger.info('Setting up auto clean cron job...')
  await connectDB()
  let { nextAt } = await getInfo()

  if (!nextAt) {
    nextAt = nextDate(cronTime)
    await metaColl.updateOne({ key: 'cacheClean', nextAt: null }, { nextAt: nextAt.toDate() })
  }

  setTimer(nextAt)
  logger.info(`Auto clean cron job will start at ${nextAt.format()}.`)
}

function stopCronJob() {
  if (timer) {
    clearTimeout(timer)
  }

  return cleaningPromise
}

function getInfo() {
  return metaColl.findOne({ key: 'cacheClean' })
}

function nextDate() {
  if (!cronTime) return null

  const job = new CronJob(cronTime, () => { /* nop */ })

  // nextDates() returns an array of Moment objects
  // https://momentjs.com/docs/
  return job.nextDates(1)[0]
}

function setTimer(nextAt) {
  const timeout = nextAt - Date.now()
  timer = setTimeout(cronJob, timeout)
}

function cronJob() {
  cleaningPromise = (async() => {
    const info = await getInfo()
    let nextAt = info.nextAt

    if (info.cleaning) {
      if (nextAt)
    } else {
      nextAt = nextDate(cronTime)
      try {
        await clean(nextAt)
      } catch (e) {
        logger.error(e)
      }
    }

    setTimer(nextAt)
    logger.info(`Auto clean next time at ${nextAt.format()}.`)
  })()
}

async function clean(isCron) {
  const now = new Date()
  const nextAt = nextDate()

  const result = metaColl.updateOne({ key: 'cacheClean', cleaningAt: null }, {
    cleaningAt: now,
    nextAt: nextAt ? nextAt.toDate() : null
  })

  if (!result.modifiedCount) {
    const info = await getInfo()

    if (info.cleaningAt) {
      const cleaningAt = moment(info.cleaningAt)
      logger[isCron ? 'warn' : 'info'](`The last cleaning job (${cleaningAt.format()}) hasn't finished yet.`)
    } else {
      logger.info()
    }
    return
  }

  try {
    logger.info('Cleaning expired snapshots...')
    const startTime = Date.now()
    const result = snapshotColl.deleteMany({ sharedExpires: { $lt: new Date() } })
    logger.info(`Cleaned ${result.deletedCount} expired snapshots (${((Date.now() - startTime) / 1000).toFixed(3)}s).`)
  } catch (e) {
    throw e
  } finally {
    await metaColl.updateOne({ key: 'cacheClean', cleaning: true }, { cleaning: false })
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

module.exports = { setupCronJob, stopCronJob, cli }
