const { db } = require('../shared/db')
const sitemap = db.collection('sitemap')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')

const PAGE_SIZE = 50000

module.exports = {
  async count(ctx) {
    const site = ctx.params.site
    try {
      new URL(site)
    } catch (e) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'site')
    }

    const urlCount = await sitemap.count({ site })
    const sitemapCount = Math.ceil(urlCount / PAGE_SIZE)
    const sitemapIndexCount = Math.ceil(sitemapCount / PAGE_SIZE)
    ctx.body = { urlCount, sitemapCount, sitemapIndexCount }
  }
}
