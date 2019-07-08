function reply(ctx, type, followRedirect, doc, cacheStatus) {
  const { updatedAt } = doc
  let { privateExpires } = doc

  if (privateExpires < Date.now()) {
    privateExpires = new Date(Date.now() + 10 * 1000)
  }

  const age = Math.round((Date.now() - updatedAt) / 1000)
  const maxage = Math.round((privateExpires - Date.now()) / 1000)
  const sMaxage = maxage <= 60 ? maxage : 60

  ctx.set('Age', age)
  ctx.set('Last-Modified', updatedAt.toUTCString())
  ctx.set('Cache-Control', `max-age=${maxage}, s-maxage=${sMaxage}`)
  ctx.set('Vary', 'Kasha-Profile, Kasha-Fallback')
  ctx.set('Expires', privateExpires.toUTCString())
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
