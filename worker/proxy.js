const AnyProxy = require('anyproxy')

const rule = {
  async beforeSendRequest(req) {
    console.log(req.url)
    console.log(req._req.headers)
  }
}

let proxy

function start() {
  return new Promise(resolve => {
    if (proxy) {
      return proxy
    }

    if (AnyProxy.utils.certMgr.ifRootCAFileExists()) {
      main()
    } else {
      AnyProxy.utils.certMgr.generateRootCA(e => {
        if (e) {
          throw e
        }

        main()
      })
    }

    function main() {
      const proxy = new AnyProxy.ProxyServer({
        port: 54100,
        rule,
        forceProxyHttps: true
      })

      proxy.on('ready', () => {
        resolve(proxy.httpProxyServer.address().port)
      })

      proxy.start()
    }
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
