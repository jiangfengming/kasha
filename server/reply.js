function reply(ctx, type, followRedirect, doc, cacheStatus) {
  if (type === 'json') {
    ctx.body = doc
  } else {
    const { status, redirect, html, staticHTML } = doc
    let { privateExpires } = doc

    if (privateExpires.getTime() < Date.now()) {
      privateExpires = new Date(Date.now() + 60 * 1000)
    }

    ctx.set('Expires', privateExpires.toGMTString())
    ctx.set('kasha-Cache-Status', cacheStatus)

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
