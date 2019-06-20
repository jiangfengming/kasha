const request = require('./request')

module.exports = async(ctx, url) => {
  const res = await request(url, {
    method: ctx.method,
    headers: ctx.headers,
    body: ctx.req
  })

  delete res.headers['content-disposition']
  ctx.status = res.statusCode
  ctx.set(res.headers)
  ctx.body = res
  return res
}
