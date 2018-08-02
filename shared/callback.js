const fetch = require('node-fetch')

const RETRY = 3
const TIMEOUT = 10

async function callback(callbackURL, error, result, cacheStatus) {
  const init = {
    method: 'POST',
    body: JSON.stringify(error || result),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'kasha',
      'Kasha-Code': error ? error.code : 'OK',
      'Kasha-Cache-Status': cacheStatus
    },
    timeout: TIMEOUT
  }

  let success = false, tried = 0
  do {
    try {
      await fetch(callbackURL, init)
      success = true
    } catch (e) {
      tried++
    }
  } while (!success && tried < RETRY)
}

module.exports = callback
