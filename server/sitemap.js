const { db } = require('../shared/db')
const sitemaps = db.collection('sitemaps')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')
const { PassThrough } = require('stream')

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

async function genSitemap(stream, data) {
  stream.write(`<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  `)

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write(`<url>${standardTags(entry)}</url>`)
  }

  stream.end('</urlset>')
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

async function genGoogleNewsSitemap(stream, data) {
  stream.write(`<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  `)

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write(`
      <url>
        ${standardTags(entry)}
        ${googleNewsTags(entry.news)}
      </url>
    `)
  }

  stream.end('</urlset>')
}

function standardTags({ site, path, lastmod, changefreq, priority }) {
  return `
    <loc>${site + path}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    ${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}
    ${priority ? `<priority>${priority}</priority>` : ''}
  `
}

function googleNewsTags(news) {
  return `
    <news:news>
      <news:publication>
        <news:name>${news.publication.name}</news:name>
        <news:language>${news.publication.language}</news:language>
      </news:publication>
      <news:publication_date>${news.publication_date}</news:publication_date>
      <news:title>${news.title}</news:title>
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

async function respond(ctx, result, gen) {
  ctx.set('Content-Type', 'text/xml')
  const count = await result.count()
  if (count) {
    const stream = new PassThrough()
    ctx.body = stream
    gen(stream, result)
  }
}

async function sitemap(ctx) {
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit)
  const page = parsePageParam(ctx.params.page)

  const result = await sitemaps.find({ site }, {
    skip: (page - 1) * limit,
    limit
  })

  await respond(ctx, result, genSitemap)
}

async function googleSitemap(ctx) {

}

async function googleNewsSitemap(ctx) {
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit)
  const page = parsePageParam(ctx.params.page)

  const result = await sitemaps.find({
    site,
    news: { $exists: true }
  }, {
    skip: (page - 1) * limit,
    limit
  })

  await respond(ctx, result, genGoogleNewsSitemap)
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
