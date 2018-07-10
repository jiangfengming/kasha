const { db } = require('../shared/db')
const sitemaps = db.collection('sitemaps')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')

const PAGE_LIMIT = 50000
// const GOOGLE_NEWS_LIMIT = 1000

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

/*

function genSitemap(data) {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${
  data.map(({ loc, lastmod, changefreq, priority }) => `
<url>
  <loc>${loc}</loc>
  ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
  ${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}
  ${priority ? `<priority>${priority}</priority>` : ''}
</url>
  `).join('')
}
</urlset>
  `
}

function genGoogleSitemap(data) {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${

}
</urlset>
  `
}

function genGoogleNewsSitemap(data) {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${

}
</urlset>
  `
}

function googleNewsItem(news) {
  return `
<url>
  <loc>http://www.example.org/business/article55.html</loc>
  <news:news>
    <news:publication>
      <news:name>The Example Times</news:name>
      <news:language>en</news:language>
    </news:publication>
    <news:genres>PressRelease, Blog</news:genres>
    <news:publication_date>2008-12-23</news:publication_date>
    <news:title>Companies A, B in Merger Talks</news:title>
    <news:keywords>business, merger, acquisition, A, B</news:keywords>
    <news:stock_tickers>NASDAQ:A, NASDAQ:B</news:stock_tickers>
  </news:news>
</url>
  `
}
*/
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
    /* eslint-disable */
    const site = parseSiteParam(ctx.params.site)
    const limit = parseLimitParam(ctx.query.limit)
    let page = parsePageParam(ctx.params.page)

    const result = await sitemaps.find({
      site,
      skip: (page - 1) * limit,
      limit
    })
  }
  /*

  async googleSitemap(ctx) {

  },

  async googleNewsSitemap(ctx) {

  },

  async googleImageSitemap(ctx) {

  },

  async googleVideoSitemap(ctx) {

  }
  */
}
