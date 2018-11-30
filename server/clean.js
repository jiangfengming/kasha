(async() => {
  const config = require('../shared/config')
  const cronTime = config.cache.autoClean

  if (!cronTime) return

  const { CronJob } = require('cron')
  const { db } = require('../shared/mongo')
  const info = await getInfo()

  if (info.cronTime === cronTime) {

  } else {
    const job = new CronJob(cronTime)

  }

  function getInfo() {
    return db.collection('meta').findOne({ key: 'autoClean' })
  }

  async function clean() {
    const info = await getInfo()

    if (info.cleaning) {

    } else {

    }
  }

  setTimeout(clean, nextTime)
})()
