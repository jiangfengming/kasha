const crypto = require('crypto')

function uid(n = 16) {
  return crypto.randomBytes(n).toString('hex')
}

function filterResult(result, fields) {
  const tmp = {}
  fields.forEach(e => tmp[e] = result[e])
  return tmp
}

module.exports = { uid, filterResult }
