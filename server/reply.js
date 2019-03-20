const MICRO_CACHE = 3

function reply(ctx, type, followRedirect, doc, cacheStatus) {
  const { privateExpires, updatedAt } = doc

  const age = Math.round((Date.now() - updatedAt) / 1000)
  let maxage = Math.round((privateExpires - updatedAt) / 1000)

  if (age > maxage) {
    maxage = age + MICRO_CACHE
  }

  ctx.set('Age', age)
  ctx.set('Cache-Control', `max-age=${maxage}`)
  ctx.set('Kasha-Code', 'OK')
  ctx.set('kasha-Cache-Status', cacheStatus)

  if (type === 'json') {
    ctx.body = doc
  } else {
    const { status, redirect, html, staticHTML } = doc

    if (redirect && !followRedirect) {
      ctx.status = status
      ctx.redirect(redirect)
    } else {
      ctx.status = status
      ctx.body = (type === 'html' ? html : staticHTML) || ''
    }
  }
}

module.exports = reply
