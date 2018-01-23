const fetch = require('node-fetch')

const RETRY = 3
const TIMEOUT = 10

function callback(callbackUrl, result) {
  const init = {
    method: 'POST',
    body: JSON.stringify(result),
    headers: {
      'Content-Type': 'application/json',
      'X-Code': result instanceof CustomError ? result.code : 'OK'
    },
    timeout: TIMEOUT
  }

  let success = false, tried = 0
  do {
    try {
      fetch(callbackUrl, init)
      success = true
    } catch (e) {
      tried++
    }
  } while (!success && tried < RETRY)
}

module.exports = callback
