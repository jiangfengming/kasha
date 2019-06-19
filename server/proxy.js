const request = require('./request')

module.exports = (url, { setHeaders = true } = {}) => async ctx => {
  const res = await request(url, {
    method: ctx.method,
    headers: ctx.headers,
    body: ctx.req
  })

  delete res.headers['content-disposition']
  ctx.status = res.statusCode

  if (setHeaders) {
    ctx.set(res.headers)
  }

  ctx.body = res
}
