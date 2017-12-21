const argv = require('yargs').argv

const configFile = argv.config || process.env.npm_config_config || 'default'
console.log('load config file:', configFile) // eslint-disable-line
const config = require('../config/' + configFile)

module.exports = config
