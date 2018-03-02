const http = require('http')

http.createServer((req, res) => {
  console.log(req.headers)
  req.on('data', chunk => console.log(chunk.toString()))
  req.on('end', () => {
    res.end()
  })
}).listen(8080)
