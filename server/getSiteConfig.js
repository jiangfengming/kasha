const config = require('../lib/config')
const mongo = require('../lib/mongo')

if (config.sites) {
  module.exports = function(host) {
    return config.sites.find(site => site.host === host)
  }
} else {
  module.exports = function(host) {
    return mongo.db.collection('sites').findOne({ host })
  }
}
