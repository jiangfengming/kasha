const config = require('../shared/config')
const { db } = require('../shared/mongo')

if (config.sites) {
  module.exports = function(host) {
    return config.sites.find(site => site.host === host)
  }
} else {
  module.exports = function(host) {
    return db.collection('sites').findOne({ host })
  }
}
