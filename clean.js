const { CronJob } = require('cron')
const config = require('./shared/config')
const mongo = require('./shared/mongo')
const logger = require('./shared/logger')

let db, metaColl, snapshotColl

async function connectDB() {
  db = await mongo.connect()
  metaColl = db.collection('meta')
  snapshotColl = db.collection('snapshots')
}

let timer
async function cron() {
  await connectDB()
  const info = await getInfo()
  const cronTime = config.cache.autoClean

  if (!cronTime && info.cronTime) {
    await
  }


  if (info.cronTime === cronTime) {
    setTimer(info.nextAt)
  } else {
    const nextAt = nextDate(cronTime)
    setTimer(nextAt)

    // cron config changed, update
    await metaColl.updateOne({ key: 'autoClean' }, {
      cronTime,
      nextAt
    })
  }
}

function stop() {
  if (timer) {
    clearTimeout(timer)
  }
}

function getInfo() {
  return metaColl.findOne({ key: 'autoClean' })
}

function nextDate(cronTime) {
  const job = new CronJob(cronTime, () => { /* nop */ })

  // nextDates() returns an array of Moment objects
  // http://momentjs.com/docs/#/displaying/unix-timestamp-milliseconds/
  return job.nextDates(1)[0].valueOf()
}

function setTimer(nextAt) {
  const timeout = nextAt - Date.now()
  timer = setTimeout(clean, timeout)
}

async function cleanInterval() {
  const info = await getInfo()

  if (!info.cleaning) {
    const nextAt = nextDate(info.cronTime)

    try {
      const result = db.collection('meta').updateOne({ key: 'autoClean', cleaning: false }, {
        cleaning: true,
        nextAt
      })

      //
      if (!result.modifiedCount) {

      }
    } catch (e) {

    }
  }

  setTimer(info.nextAt)
}

async function clean() {
  logger.info('Cleanning...')
  const result = snapshotColl.deleteMany({ sharedExpires: { $lt: new Date() } })
  logger.info(`Cleaned ${result.deletedCount} expired snapshots`)
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
