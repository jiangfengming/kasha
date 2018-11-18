const { resolve } = require('path')

const configFile = resolve(global.argv.config)

// global logger hasn't been initialized, use console.log()
console.log('load config file:', configFile) // eslint-disable-line
const config = require(configFile)

if (config.apiHost) config.apiHost = [].concat(config.apiHost)

// sort sites config
// make default config of a host comes before others
if (config.sites) {
  config.sites.sort((a, b) => {
    const a1 = a.host + (a.default ? '1' : '0')
    const b1 = b.host + (b.default ? '1' : '0')
    if (a1 === b1) throw new Error(`${a.host} has duplicated default config.`)
    return a1 > b1 ? -1 : 1
  })
}

module.exports = config
