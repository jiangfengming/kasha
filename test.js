const { CronJob } = require('cron')

const job = new CronJob('* * * * *', () => console.log(new Date()))

console.log(job.nextDates(1)[0].format())
