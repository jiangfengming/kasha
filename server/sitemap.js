const { db } = require('../shared/db')
const sitemaps = db.collection('sitemaps')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')

const PAGE_LIMIT = 50000
const GOOGLE_NEWS_LIMIT = 1000

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

function genSitemap(data) {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${data.map(page => `<url>${standardTags(page)}</url>`).join('')}
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
  data.map(page => `
<url>
  ${standardTags(page)}
</url>
  `).join('')
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

function standardTags(page) {
  return `
<loc>${loc}</loc>
${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}
${priority ? `<priority>${priority}</priority>` : ''}
  `
}

function googleNews(page) {
  return `
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
  `
}

function googleImage(page) {
  return `
<image:image>
  <image:loc></image:loc>
  <image:caption></image:caption>
  <image:geo_location></image:geo_location>
  <image:title></image:title>
  <image:license></image:license>
</image:image>
  `
}

function googleVideo(page) {
  return `
<video:video>
  <video:thumbnail_loc></video:thumbnail_loc>
  <video:title></video:title>
  <video:description></video:description>
  <video:content_loc></video:content_loc>
  <video:player_loc></video:player_loc>
  <video:duration></video:duration>
  <video:expiration_date></video:expiration_date>
  <video:rating></video:rating>
  <video:view_count></video:view_count>
  <video:publication_date></video:publication_date>
  <video:family_friendly></video:family_friendly>
  <video:tag></video:tag>
  <video:category></video:category>
  <video:restriction></video:restriction>
  <video:gallery_loc></video:gallery_loc>
  <video:price></video:price>
  <video:requires_subscription></video:requires_subscription>
  <video:uploader></video:uploader>
  <video:platform></video:platform>
  <video:live></video:live>
</video:video>
  `
}

async function count(ctx) {
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
}

async function sitemap(ctx) {
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit)
  let page = parsePageParam(ctx.params.page)

  const result = await sitemaps.find({
    site,
    skip: (page - 1) * limit,
    limit
  })
}

async function googleSitemap(ctx) {

}

async function googleNewsSitemap(ctx) {

}

async function googleImageSitemap(ctx) {

}

async function googleVideoSitemap(ctx) {

}

module.exports = {
  count,
  sitemap,
  googleSitemap,
  googleNewsSitemap,
  googleImageSitemap,
  googleVideoSitemap
}
