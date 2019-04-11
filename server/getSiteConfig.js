const config = require('../lib/config')
const { db } = require('../lib/mongo')

if (config.sites) {
  module.exports = function(host) {
    return config.sites.find(site => site.host === host)
  }
} else {
  module.exports = function(host) {
    return db.collection('sites').findOne({ host })
  }
}
