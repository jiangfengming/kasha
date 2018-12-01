const { CronJob } = require('cron')
const config = require('./shared/config')
const { db } = require('./shared/mongo')
const logger = require('./shared/logger')

const metaColl = db.collection('meta')
let timer

async function start() {
  const cronTime = config.cache.autoClean
  if (!cronTime) return

  const info = await getInfo()

  if (info.cronTime === cronTime) {
    setTimer(info.nextAt)
  } else {
    const nextAt = nextDate(cronTime)
    setTimer(nextAt)

    // cron config changed
    // update
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

async function clean() {
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

module.exports = { start, stop }
