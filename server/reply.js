function reply(ctx, type, followRedirect, doc) {
  if (type === 'json') {
    ctx.body = doc
  } else {
    const { status, redirect, html, staticHTML } = doc
    let { privateExpires } = doc

    if (!(privateExpires instanceof Date)) privateExpires = new Date(privateExpires)

    ctx.set('Expires', privateExpires.toGMTString())

    if (redirect && !followRedirect) {
      ctx.status = status
      ctx.redirect(redirect)
    } else {
      ctx.status = status
      ctx.body = type === 'html' ? html : staticHTML
    }
  }
}

module.exports = reply
