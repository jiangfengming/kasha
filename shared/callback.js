const { URL } = require('url')
const fetch = require('node-fetch')

const RETRY = 3
const TIMEOUT = 10

function callback(callbackUrl, result) {
  const url = new URL(callbackUrl)
  url.searchParams.set('code', result instanceof CustomError ? result.code : 'OK')

  const init = {
    method: 'POST',
    body: JSON.stringify(result),
    headers: {
      'Content-Type': 'application/json'
    },
    timeout: TIMEOUT
  }

  let success = false, tried = 0
  do {
    try {
      fetch(url.href, init)
      success = true
    } catch (e) {
      tried++
    }
  } while (!success && tried < RETRY)
}

module.exports = callback
