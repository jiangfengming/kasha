const { resolve } = require('path')

const configFile = resolve(global.argv.config)

// global logger hasn't been initialized, use console.log()
console.log('load config file:', configFile) // eslint-disable-line
const config = require(configFile)

if (config.apiHost) {
  config.apiHost = [].concat(config.apiHost)
}

module.exports = config
