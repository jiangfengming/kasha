const { db } = require('../shared/db')
const sitemaps = db.collection('sitemaps')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')

const PAGE_LIMIT = 50000
const NEWS_LIMIT = 1000

function parseSiteParam(site) {
  try {
    return new URL(site).origin
  } catch (e) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'site')
  }
}

function parseLimitParam(limit) {
  if (limit) {
    limit = parseInt(limit)
    if (isNaN(limit) || limit <= 0 || limit > PAGE_LIMIT) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'limit')
    } else {
      return limit
    }
  } else {
    return PAGE_LIMIT
  }
}

function parsePageParam(page) {
  if (page) {
    page = parseInt(page)
    if (isNaN(page) || page <= 0) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'page')
    } else {
      return page
    }
  } else {
    return 1
  }
}

function genXML(data) {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${
  data.map(({ loc, lastmod, changefreq, priority, image }) => `
<url>
  <loc>http://www.example.com/foo.html</loc>
  <image:image>
    <image:loc>http://example.com/image.jpg</image:loc>
  </image:image>
</url>
  `).join('')
}
</urlset>
  `
}

module.exports = {
  async count(ctx) {
    const site = parseSiteParam(ctx.params.site)
    const limit = parseLimitParam(ctx.query.limit)
    const urlCount = await sitemaps.count({ site })
    const sitemapCount = Math.ceil(urlCount / limit)
    const sitemapIndexCount = Math.ceil(sitemapCount / PAGE_LIMIT)
    ctx.body = {
      url: urlCount,
      sitemap: sitemapCount,
      sitemapIndex: sitemapIndexCount
    }
  },

  async sitemap(ctx) {
    const site = parseSiteParam(ctx.params.site)
    const limit = parseLimitParam(ctx.query.limit)
    let page = parsePageParam(ctx.params.page)

    const result = await sitemaps.find({
      site,
      skip: (page -1) * limit,
      limit
    })


  },

  async
}
