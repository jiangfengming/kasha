const config = require('../shared/config')

function reply(ctx, type, followRedirect, doc, cacheStatus) {
  if (type === 'json') {
    ctx.body = doc
  } else {
    const { status, redirect, html, staticHTML } = doc
    const { privateExpires } = doc

    let maxage = Math.round((privateExpires.getTime() - Date.now()) / 1000)
    if (maxage < config.cache.maxStale) maxage = config.cache.maxStale

    ctx.set('Cache-Control', `max-age=${maxage}`)
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
