const { URL } = require('url')
const fetch = require('node-fetch')

const RETRY = 3
const TIMEOUT = 10

function callback(callbackUrl, url, state, result) {
  callbackUrl = new URL(callbackUrl)
  callbackUrl.searchParams.set('url', url)
  callbackUrl.searchParams.set('state', state)

  let success = false, tried = 0
  do {
    try {
      fetch(callbackUrl.href, {
        method: 'POST',
        body: JSON.stringify(result),
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: TIMEOUT
      })
      success = true
    } catch (e) {
      tried++
    }
  } while (!success && tried < RETRY)
}

module.exports = callback
