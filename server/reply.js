function reply(ctx, type, followRedirect, doc) {
  if (type === 'json') {
    ctx.body = doc
  } else {
    const { status, redirect, meta, html, staticHTML } = doc
    if (redirect && !followRedirect) {
      ctx.status = status
      ctx.redirect(redirect)
    } else {
      ctx.status = status
      if (meta.cacheControl) ctx.set('Cache-Control', meta.cacheControl)
      if (meta.expires) ctx.set('Expires', meta.expires)
      ctx.body = type === 'html' ? html : staticHTML
    }
  }
}

module.exports = reply
