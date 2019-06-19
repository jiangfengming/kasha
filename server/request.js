const http = require('http')
const https = require('https')

const hopByHopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]

module.exports = function(url, { method, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    url = new URL(url)
    url.searchParams.sort()

    const request = url.protocol === 'http:' ? http.request : https.request

    headers = { ...headers }
    delete headers.host

    const req = request(url.href, { method, headers }, res => {
      const headers = {}

      for (const k in res.headers) {
        if (!hopByHopHeaders.includes(k)) {
          headers[k] = res.headers[k]
        }
      }

      res.headers = headers
      resolve(res)
    })

    req.on('error', e => reject(e))

    if (body && body.pipe) {
      body.pipe(req)
    } else {
      req.end(body)
    }
  })
}
