const fetch = require('node-fetch')

const RETRY = 3
const TIMEOUT = 10

async function callback(callbackUrl, error, result) {
  const init = {
    method: 'POST',
    body: JSON.stringify(error || result),
    headers: {
      'Content-Type': 'application/json',
      'X-Code': error ? error.code : 'OK',
      'User-Agent': 'kasha'
    },
    timeout: TIMEOUT
  }

  let success = false, tried = 0
  do {
    try {
      await fetch(callbackUrl, init)
      success = true
    } catch (e) {
      tried++
    }
  } while (!success && tried < RETRY)
}

module.exports = callback
