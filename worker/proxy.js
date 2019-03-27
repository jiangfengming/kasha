const _proxy = require('http-mitm-proxy')

let proxy
function start() {
  return new Promise(resolve => {
    if (proxy) {
      return resolve(proxy.httpPort)
    }

    proxy = _proxy()

    proxy.use(_proxy.wildcard)

    proxy.onRequest((ctx, cb) => {
      const req = ctx.clientToProxyRequest
      const url = (ctx.isSSL ? 'https://' : 'http://') + req.headers.host + req.url

      return cb()
    })

    proxy.listen({ forceSNI: true }, () => {
      resolve(proxy.httpPort)
    })
  })
}

function stop() {
  if (!proxy) {
    return
  }

  proxy.close()
  proxy = null
}

module.exports = { start, stop }
