const { CronJob } = require('cron')
const config = require('./shared/config')
const mongo = require('./shared/mongo')
const logger = require('./shared/logger')
const cronTime = config.cache.autoClean

let db, metaColl, snapshotColl

async function connectDB() {
  db = await mongo.connect()
  metaColl = db.collection('meta')
  snapshotColl = db.collection('snapshots')
}

let timer
let cleaningPromise = Promise.resolve()

async function cron() {
  if (!cronTime) return

  logger.info('Setting up auto clean cron job...')
  await connectDB()
  let { nextAt } = await getInfo()

  if (!nextAt) {
    nextAt = nextDate(cronTime)
    await metaColl.updateOne({ key: 'autoClean', nextAt: null }, { nextAt })
  }

  setTimer(nextAt)
  logger.info(`Auto clean cron job will start at ${nextAt.format()}.`)
}

function stop() {
  if (timer) {
    clearTimeout(timer)
  }

  return cleaningPromise
}

function getInfo() {
  return metaColl.findOne({ key: 'autoClean' })
}

function nextDate(cronTime) {
  const job = new CronJob(cronTime, () => { /* nop */ })

  // nextDates() returns an array of Moment objects
  // https://momentjs.com/docs/
  return job.nextDates(1)[0]
}

function setTimer(nextAt) {
  const timeout = nextAt - Date.now()
  timer = setTimeout(cleanCronJob, timeout)
}

function cleanCronJob() {
  cleaningPromise = (async() => {
    const info = await getInfo()
    let nextAt = info.nextAt

    if (!info.cleaning) {
      nextAt = nextDate(cronTime)

      let result
      try {
        result = metaColl.updateOne({ key: 'autoClean', cleaning: false }, {
          cleaning: true,
          nextAt
        })
      } catch (e) {
        logger.error(e)
      }

      if (result.modifiedCount) {
        try {
          await clean()
        } catch (e) {
          logger.error(e)
        } finally {

        }
      }
    }

    setTimer(nextAt)
    logger.info(`Auto clean next time at ${nextAt.format()}.`)
  })()
}

async function clean() {
  logger.info('Cleaning expired snapshots...')
  const startTime = Date.now()
  const result = snapshotColl.deleteMany({ sharedExpires: { $lt: new Date() } })
  logger.info(`Cleaned ${result.deletedCount} expired snapshots (${Date.now() - startTime}ms).`)
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

module.exports = { cron, stop, cli }
