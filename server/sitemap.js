const { db } = require('../shared/db')
const sitemaps = db.collection('sitemaps')
const { URL } = require('url')
const CustomError = require('../shared/CustomError')
const { PassThrough } = require('stream')
const { XmlEntities } = require('html-entities')

const PAGE_LIMIT = 50000
const GOOGLE_NEWS_LIMIT = 1000

const entities = new XmlEntities()

function parseSiteParam(site) {
  try {
    return new URL(site).origin
  } catch (e) {
    throw new CustomError('CLIENT_INVALID_PARAM', 'site')
  }
}

function parseLimitParam(limit, max = PAGE_LIMIT) {
  if (limit) {
    limit = parseInt(limit)
    if (isNaN(limit) || limit <= 0 || limit > max) {
      throw new CustomError('CLIENT_INVALID_PARAM', 'limit')
    } else {
      return limit
    }
  } else {
    return max
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
  stream.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write('<url>')
    stream.write(standardTags(entry))
    stream.write('</url>')
  }

  stream.end('</urlset>')
}

async function genGoogleSitemap(stream, data) {
  stream.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">')

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write('<url>')
    stream.write(standardTags(entry))

    if (entry.news) {
      stream.write(googleNewsTags(entry.news))
    }

    if (entry.image) {
      entry.image.forEach(img => stream.write(googleImageTags(img)))
    }

    if (entry.video) {
      entry.video.forEach(video => stream.write(googleVideoTags(video)))
    }

    stream.write('</url>')
  }

  stream.end('</urlset>')
}

async function genGoogleNewsSitemap(stream, data) {
  stream.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">')

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write('<url>')
    stream.write(standardTags(entry))
    stream.write(googleNewsTags(entry.news))
    stream.write('</url>')
  }

  stream.end('</urlset>')
}

async function genGoogleImageSitemap(stream, data) {
  stream.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">')

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write('<url>')
    stream.write(standardTags(entry))
    entry.image.forEach(img => stream.write(googleImageTags(img)))
    stream.write('</url>')
  }

  stream.end('</urlset>')
}

async function genGoogleVideoSitemap(stream, data) {
  stream.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">')

  let entry
  while (entry = await data.next()) { // eslint-disable-line no-cond-assign
    stream.write('<url>')
    stream.write(standardTags(entry))
    entry.video.forEach(video => stream.write(googleVideoTags(video)))
    stream.write('</url>')
  }

  stream.end('</urlset>')
}

function standardTags(page) {
  let tags = `<loc>${entities.encode(page.site + page.path)}</loc>`
  if (page.lastmod) tags += `<lastmod>${page.lastmod}</lastmod>`
  if (page.changefreq) tags += `<changefreq>${page.changefreq}</changefreq>`
  if (page.priority) tags += `<priority>${page.priority}</priority>`
  return tags
}

function googleNewsTags(news) {
  let tags = '<news:news>'
  tags += '<news:publication>'
  tags += `<news:name>${entities.encode(news.publication.name)}</news:name>`
  tags += `<news:language>${news.publication.language}</news:language>`
  tags += '</news:publication>'
  tags += `<news:publication_date>${news.publication_date.toISOString()}</news:publication_date>`
  tags += `<news:title>${entities.encode(news.title)}</news:title>`
  tags += '</news:news>'
  return tags
}

function googleImageTags(image) {
  let tags = '<image:image>'
  tags += `<image:loc>${entities.encode(image.loc)}</image:loc>`
  if (image.caption) tags += `<image:caption>${entities.encode(image.caption)}</image:caption>`
  if (image.geo_location) tags += `<image:geo_location>${entities.encode(image.geo_location)}</image:geo_location>`
  if (image.title) tags += `<image:title>${entities.encode(image.title)}</image:title>`
  if (image.license) tags += `<image:license>${entities.encode(image.license)}</image:license>`
  tags += '</image:image>'
  return tags
}

function googleVideoTags(video) {
  let tags = '<video:video>'
  tags += `<video:thumbnail_loc>${entities.encode(video.thumbnail_loc)}</video:thumbnail_loc>`
  tags += `<video:title>${entities.encode(video.title)}</video:title>`
  tags += `<video:description>${entities.encode(video.description)}</video:description>`
  if (video.content_loc) tags += `<video:content_loc>${entities.encode(video.content_loc)}</video:content_loc>`
  if (video.player_loc) tags += `<video:player_loc${video.player_loc.allow_embed ? ` allow_embed="${video.player_loc.allow_embed}"` : ''}>${entities.encode(video.player_loc._)}</video:player_loc>`
  if (video.duration) tags += `<video:duration>${video.duration}</video:duration>`
  if (video.expiration_date) tags += `<video:expiration_date>${video.expiration_date}</video:expiration_date>`
  if (video.rating) tags += `<video:rating>${video.rating}</video:rating>`
  if (video.view_count) tags += `<video:view_count>${video.view_count}</video:view_count>`
  if (video.publication_date) tags += `<video:publication_date>${video.publication_date}</video:publication_date>`
  if (video.family_friendly) tags += `<video:family_friendly>${video.family_friendly}</video:family_friendly>`
  if (video.restriction) tags += `<video:restriction relationship="${video.restriction.relationship}">${video.restriction._}</video:restriction>`
  if (video.platform) tags += `<video:platform relationship="${video.platform.relationship}">${video.platform._}</video:platform>`
  if (video.price) tags += `<video:price currency="${video.price.currency}"${video.price.type ? ` type="${video.price.type}"` : ''}${video.price.resolution ? ` resolution="${video.price.resolution}"` : ''}>${video.price._}</video:price>`
  if (video.requires_subscription) tags += `<video:requires_subscription>${video.requires_subscription}</video:requires_subscription>`
  if (video.uploader) tags += `<video:uploader${video.uploader.info ? ` info="${entities.encode(video.uploader.info)}"` : ''}>${entities.encode(video.uploader._)}</video:uploader>`
  if (video.live) tags += `<video:live>${video.live}</video:live>`
  if (video.tag) tags += video.tag.map(t => `<video:tag>${entities.encode(t)}</video:tag>`).join('')
  if (video.category) tags += `<video:category>${entities.encode(video.category)}</video:category>`
  if (video.gallery_loc) tags += `<video:gallery_loc>${entities.encode(video.gallery_loc)}</video:gallery_loc>`
  tags += '</video:video>'
  return tags
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
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit)
  const page = parsePageParam(ctx.params.page)

  const result = await sitemaps.find({ site }, {
    skip: (page - 1) * limit,
    limit
  })

  await respond(ctx, result, genGoogleSitemap)
}

async function googleNewsSitemap(ctx) {
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit, GOOGLE_NEWS_LIMIT)
  const page = parsePageParam(ctx.params.page)

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

  const result = await sitemaps.find({
    site,
    'news.publication_date': { $gte: twoDaysAgo }
  }, {
    skip: (page - 1) * limit,
    limit
  })

  await respond(ctx, result, genGoogleNewsSitemap)
}

async function googleImageSitemap(ctx) {
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit)
  const page = parsePageParam(ctx.params.page)

  const result = await sitemaps.find({
    site,
    image: { $exists: true }
  }, {
    skip: (page - 1) * limit,
    limit
  })

  await respond(ctx, result, genGoogleImageSitemap)
}

async function googleVideoSitemap(ctx) {
  const site = parseSiteParam(ctx.params.site)
  const limit = parseLimitParam(ctx.query.limit)
  const page = parsePageParam(ctx.params.page)

  const result = await sitemaps.find({
    site,
    video: { $exists: true }
  }, {
    skip: (page - 1) * limit,
    limit
  })

  await respond(ctx, result, genGoogleVideoSitemap)
}

module.exports = {
  count,
  sitemap,
  googleSitemap,
  googleNewsSitemap,
  googleImageSitemap,
  googleVideoSitemap
}
