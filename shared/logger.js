const sentry = require('@sentry/node')
const config = require('./config')
const Logger = require('raven-logger')

if (config.sentry) {
  sentry.init(config.sentry)
}

module.exports = new Logger({
  sentry: config.sentry ? sentry : null,
  logLevel: config.logLevel
})
