const { db } = require('../shared/db')
const sitemaps = db.collection('sitemaps')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')

const PAGE_SIZE = 50000

module.exports = {
  async count(ctx) {
    const site = ctx.params.site
    let limit
    if (ctx.query.limit) {
      limit = parseInt(ctx.query.limit)
      if (isNaN(limit) || limit <= 0 || limit > PAGE_SIZE) throw new CustomError('CLIENT_INVALID_PARAM', 'limit')
    } else {
      limit = PAGE_SIZE
    }

    try {
      new URL(site)
    } catch (e) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'site')
    }

    const urlCount = await sitemaps.count({ site })
    const sitemapCount = Math.ceil(urlCount / limit)
    const sitemapIndexCount = Math.ceil(sitemapCount / PAGE_SIZE)
    ctx.body = {
      url: urlCount,
      sitemap: sitemapCount,
      sitemapIndex: sitemapIndexCount
    }
  }
}
