const config = require('./config')
const pino = require('pino')

module.exports = pino({
  level: config.logLevel || 'info',
  base: null
})
