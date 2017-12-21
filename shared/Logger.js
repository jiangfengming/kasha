require('colors')
const Raven = require('raven')
const { inspect } = require('util')
const uid = require('./uid')

class Logger {
  constructor({ sentry } = {}) {
    if (sentry && sentry.dsn) {
      this.Raven = new Raven.Client()
      this.Raven.config(sentry.dsn, sentry.options).install()
    }
  }

  log(level, msg, meta) {
    let err
    if (msg instanceof Error) {
      err = msg
      msg = inspect(err)
    }

    let eventId = new Date().toISOString() + '-'
    if (this.Raven && ['error', 'warn'].includes(level)) {
      eventId += err ? this.Raven.captureException(err, meta) : this.Raven.captureMessage(msg, meta)
    } else {
      eventId += uid()
    }


    msg = `[${eventId}-${level}]`.magenta + ' ' + msg

    if (['error', 'warn'].includes(level)) {
      console.error(msg) // eslint-disable-line
    } else {
      console.log(msg) // eslint-disable-line
    }

    return eventId
  }

  error(...args) {
    return this.log('error', ...args)
  }

  warn(...args) {
    return this.log('warn', ...args)
  }

  info(...args) {
    return this.log('info', ...args)
  }

  verbose(...args) {
    return this.log('verbose', ...args)
  }

  debug(...args) {
    return this.log('debug', ...args)
  }

  silly(...args) {
    return this.log('silly', ...args)
  }
}

module.exports = Logger
