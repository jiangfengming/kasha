const crypto = require('crypto')

function uid(n = 16) {
  return crypto.randomBytes(n).toString('hex')
}

module.exports = uid
