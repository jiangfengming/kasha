const raven = require('raven')
const config = require('./config')
const Logger = require('raven-logger')

if (config.sentry && config.sentry.dsn) {
  raven.config(config.sentry.dsn, config.sentry.options).install()
}

module.exports = new Logger({ raven })
