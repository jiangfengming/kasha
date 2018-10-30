const config = require('./config')
const { db } = require('./mongo')

if (config.sites) {
  module.exports = function({ host, protocol }) {
    return config.sites.find(site => site.host === host && protocol ? site.protocol === protocol : true)
  }
} else {
  module.exports = function(query) {
    return db.collection('sites').find(query).sort({ default: -1 }).limit(1).next()
  }
}
