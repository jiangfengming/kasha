const argv = require('yargs').argv
const { resolve } = require('path')

const configFile = resolve(argv.config)

// global logger hasn't been initialized, use console.log()
console.log('load config file:', configFile) // eslint-disable-line
module.exports = require(configFile)
