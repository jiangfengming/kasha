const http = require('http')

const server = http.createServer((req, res) => {
  console.log(req.url) // eslint-disable-line no-console
  console.log(req.headers) // eslint-disable-line no-console
  req.pipe(process.stdout)
  res.end()
})

server.listen(8888)
