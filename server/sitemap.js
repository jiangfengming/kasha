const { PassThrough, Transform } = require('stream')
const { XmlEntities } = require('html-entities')
const fetch = require('node-fetch')
const URLRewriter = require('url-rewrite')
const mongo = require('../lib/mongo')
const RESTError = require('../lib/RESTError')
const config = require('../lib/config')
const logger = require('../lib/logger')

const PAGE_LIMIT = 50000
const GOOGLE_LIMIT = 1000

const entities = new XmlEntities()

function checkLimitParam(limit, max) {
  if (limit <= 0 || limit > max) {
    throw new RESTError('INVALID_PARAM', 'limit')
  }
}

function checkPageParam(page) {
  if (page <= 0) {
    throw new RESTError('INVALID_PARAM', 'page')
  }
}

const standardSitemapStream = {
  header: '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',

  transform(doc, encoding, cb) {
    cb(null, `<url>${standardTags(doc)}</url>`)
  }
}

const googleSitemapStream = {
  header: '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',

  transform(doc, encoding, cb) {
    this.push('<url>')
    this.push(standardTags(doc))

    if (doc.news) {
      this.push(googleNewsTags(doc.news))
    }

    if (doc.image) {
      doc.image.forEach(img => this.push(googleImageTags(img)))
    }

    if (doc.video) {
      doc.video.forEach(video => this.push(googleVideoTags(video)))
    }

    this.push('</url>')
    cb()
  }
}

const googleNewsSitemapStream = {
  header: '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',

  transform(doc, encoding, cb) {
    cb(null, `<url>${standardTags(doc)}${googleNewsTags(doc.news)}</url>`)
  }
}

const googleImageSitemapStream = {
  header: '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',

  transform(doc, encoding, cb) {
    this.push('<url>')
    this.push(standardTags(doc))
    doc.image.forEach(img => this.push(googleImageTags(img)))
    this.push('</url>')
    cb()
  }
}

const googleVideoSitemapStream = {
  header: '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',

  transform(doc, encoding, cb) {
    this.push('<url>')
    this.push(standardTags(doc))
    doc.video.forEach(video => this.push(googleVideoTags(video)))
    this.push('</url>')
    cb()
  }
}

function standardTags(page) {
  let tags = `<loc>${entities.encode(page.site + page.path)}</loc>`

  if (page.lastmod) {
    tags += `<lastmod>${page.lastmod}</lastmod>`
  }

  if (page.changefreq) {
    tags += `<changefreq>${page.changefreq}</changefreq>`
  }

  if (page.priority) {
    tags += `<priority>${page.priority}</priority>`
  }

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

  if (image.caption) {
    tags += `<image:caption>${entities.encode(image.caption)}</image:caption>`
  }

  if (image.geo_location) {
    tags += `<image:geo_location>${entities.encode(image.geo_location)}</image:geo_location>`
  }

  if (image.title) {
    tags += `<image:title>${entities.encode(image.title)}</image:title>`
  }

  if (image.license) {
    tags += `<image:license>${entities.encode(image.license)}</image:license>`
  }

  tags += '</image:image>'
  return tags
}

function googleVideoTags(video) {
  let tags = '<video:video>'
  tags += `<video:thumbnail_loc>${entities.encode(video.thumbnail_loc)}</video:thumbnail_loc>`
  tags += `<video:title>${entities.encode(video.title)}</video:title>`
  tags += `<video:description>${entities.encode(video.description)}</video:description>`

  if (video.content_loc) {
    tags += `<video:content_loc>${entities.encode(video.content_loc)}</video:content_loc>`
  }

  if (video.player_loc) {
    tags += `<video:player_loc${video.player_loc.allow_embed ? ` allow_embed="${video.player_loc.allow_embed}"` : ''}>${entities.encode(video.player_loc._)}</video:player_loc>`
  }

  if (video.duration) {
    tags += `<video:duration>${video.duration}</video:duration>`
  }

  if (video.expiration_date) {
    tags += `<video:expiration_date>${video.expiration_date}</video:expiration_date>`
  }

  if (video.rating) {
    tags += `<video:rating>${video.rating}</video:rating>`
  }

  if (video.view_count) {
    tags += `<video:view_count>${video.view_count}</video:view_count>`
  }

  if (video.publication_date) {
    tags += `<video:publication_date>${video.publication_date}</video:publication_date>`
  }

  if (video.family_friendly) {
    tags += `<video:family_friendly>${video.family_friendly}</video:family_friendly>`
  }

  if (video.restriction) {
    tags += `<video:restriction relationship="${video.restriction.relationship}">${video.restriction._}</video:restriction>`
  }

  if (video.platform) {
    tags += `<video:platform relationship="${video.platform.relationship}">${video.platform._}</video:platform>`
  }

  if (video.price) {
    tags += `<video:price currency="${video.price.currency}"${video.price.type ? ` type="${video.price.type}"` : ''}${video.price.resolution ? ` resolution="${video.price.resolution}"` : ''}>${video.price._}</video:price>`
  }

  if (video.requires_subscription) {
    tags += `<video:requires_subscription>${video.requires_subscription}</video:requires_subscription>`
  }

  if (video.uploader) {
    tags += `<video:uploader${video.uploader.info ? ` info="${entities.encode(video.uploader.info)}"` : ''}>${entities.encode(video.uploader._)}</video:uploader>`
  }

  if (video.live) {
    tags += `<video:live>${video.live}</video:live>`
  }

  if (video.tag) {
    tags += video.tag.map(t => `<video:tag>${entities.encode(t)}</video:tag>`).join('')
  }

  if (video.category) {
    tags += `<video:category>${entities.encode(video.category)}</video:category>`
  }

  if (video.gallery_loc) {
    tags += `<video:gallery_loc>${entities.encode(video.gallery_loc)}</video:gallery_loc>`
  }

  tags += '</video:video>'
  return tags
}

async function respond(ctx, data, { header, transform }) {
  if (await data.count() === 0) {
    return
  }

  ctx.set('Content-Type', 'text/xml; charset=utf-8')
  ctx.set('Cache-Control', `max-age=${config.cache.sitemap}`)
  ctx.body = new PassThrough()

  ctx.body.on('error', async() => {
    try {
      await data.close()
    } catch (e) {
      logger.debug(e)
    }
  })

  ctx.body.write(header)

  const trans = new Transform({
    writableObjectMode: true,
    transform
  })

  trans.setEncoding('utf8')

  trans.on('end', () => {
    ctx.body.end('</urlset>')
  })

  data.pipe(trans).pipe(ctx.body, { end: false })
}

async function sitemap(ctx) {
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: PAGE_LIMIT })
  checkLimitParam(limit, PAGE_LIMIT)
  const page = ctx.params.int('page', { defaults: 1 })
  checkPageParam(page)

  const query = { site }

  const options = {
    skip: (page - 1) * limit,
    limit
  }

  logger.debug('query sitemaps', query, options)
  const data = await mongo.db.collection('sitemaps').find(query, options)

  await respond(ctx, data, standardSitemapStream)
}

async function googleSitemap(ctx) {
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: GOOGLE_LIMIT })
  checkLimitParam(limit, GOOGLE_LIMIT)
  const page = ctx.params.int('page', { defaults: 1 })
  checkPageParam(page)

  const query = { site }

  const options = {
    skip: (page - 1) * limit,
    limit
  }

  logger.debug('query sitemaps', query, options)
  const data = await mongo.db.collection('sitemaps').find(query, options)

  await respond(ctx, data, googleSitemapStream)
}

async function googleSitemapItem(ctx) {
  const site = ctx.state.origin
  const path = ctx.params.string('path')

  const query = { site, path }
  const options = { limit: 1 }
  logger.debug('query sitemaps', query, options)
  const data = await mongo.db.collection('sitemaps').find(query, options)

  await respond(ctx, data, googleSitemapStream)
}

async function googleNewsSitemap(ctx) {
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: GOOGLE_LIMIT })
  checkLimitParam(limit, GOOGLE_LIMIT)
  const page = ctx.params.int('page', { defaults: 1 })
  checkPageParam(page)

  const query = {
    site,
    'news.publication_date': { $gte: twoDaysAgo() }
  }

  const options = {
    skip: (page - 1) * limit,
    limit
  }

  logger.debug('query sitemaps', query, options)
  const data = await mongo.db.collection('sitemaps').find(query, options)

  await respond(ctx, data, googleNewsSitemapStream)
}

function twoDaysAgo() {
  return new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
}

async function googleImageSitemap(ctx) {
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: GOOGLE_LIMIT })
  checkLimitParam(limit, GOOGLE_LIMIT)
  const page = ctx.params.int('page', { defaults: 1 })
  checkPageParam(page)

  const query = {
    site,
    hasImages: true
  }

  const options = {
    skip: (page - 1) * limit,
    limit
  }

  logger.debug('query sitemaps', query, options)
  const data = await mongo.db.collection('sitemaps').find(query, options)

  await respond(ctx, data, googleImageSitemapStream)
}

async function googleVideoSitemap(ctx) {
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: GOOGLE_LIMIT })
  checkLimitParam(limit, GOOGLE_LIMIT)
  const page = ctx.params.int('page', { defaults: 1 })
  checkPageParam(page)

  const query = {
    site,
    hasVideos: true
  }

  const options = {
    skip: (page - 1) * limit,
    limit
  }

  logger.debug('query sitemaps', query, options)
  const data = await mongo.db.collection('sitemaps').find(query, options)

  await respond(ctx, data, googleVideoSitemapStream)
}

async function robotsTxt(ctx) {
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: PAGE_LIMIT })
  checkLimitParam(limit, PAGE_LIMIT)
  const googleLimit = ctx.queries.int('googleLimit', { defaults: GOOGLE_LIMIT })
  checkLimitParam(googleLimit, GOOGLE_LIMIT)

  const queryAll = { site }
  const queryNews = { site, 'news.publication_date': { $gte: twoDaysAgo() } }
  const queryImages = { site, hasImages: true }
  const queryVideos = { site, hasVideos: true }
  logger.debug('count sitemaps', queryAll, queryNews, queryImages, queryVideos)

  const sitemaps = mongo.db.collection('sitemaps')

  const [allCount, newsCount, imageCount, videoCount, rules] = await Promise.all([
    sitemaps.countDocuments(queryAll),
    sitemaps.countDocuments(queryNews),
    sitemaps.countDocuments(queryImages),
    sitemaps.countDocuments(queryVideos),

    (async() => {
      let url = site + '/robots.txt'

      if (ctx.state.site && ctx.state.site.rewrites) {
        url = new URLRewriter(ctx.state.site.rewrites).from(url)

        if (!url) {
          return ''
        }
      }

      logger.debug('fetch robots.txt:', url)

      try {
        const res = await fetch(url, {
          headers: {
            accept: 'text/plain'
          }
        })

        if (!res.ok || !res.headers.get('content-type').includes('text/plain')) {
          return ''
        }

        return res.text()
      } catch (e) {
        return ''
      }
    })()
  ])

  const normalSitemapIndexCount = Math.ceil(allCount / limit / PAGE_LIMIT)
  const googleSitemapIndexCount = Math.ceil(allCount / googleLimit / PAGE_LIMIT)
  const newsSitemapIndexCount = Math.ceil(newsCount / googleLimit / PAGE_LIMIT)
  const imageSitemapIndexCount = Math.ceil(imageCount / googleLimit / PAGE_LIMIT)
  const videoSitemapIndexCount = Math.ceil(videoCount / googleLimit / PAGE_LIMIT)

  ctx.set('Cache-Control', `max-age=${config.cache.robotsTxt}`)
  ctx.body = rules + '\n'

  for (let n = 1; n <= normalSitemapIndexCount; n++) {
    ctx.body += `Sitemap: ${site}/sitemap.index.${n}.xml`

    if (limit !== PAGE_LIMIT) {
      ctx.body += `?limit=${limit}`
    }

    ctx.body += '\n'
  }

  for (let n = 1; n <= googleSitemapIndexCount; n++) {
    ctx.body += `Sitemap: ${site}/sitemap.index.google.${n}.xml`

    if (googleLimit !== GOOGLE_LIMIT) {
      ctx.body += `?limit=${googleLimit}`
    }

    ctx.body += '\n'
  }

  for (let n = 1; n <= newsSitemapIndexCount; n++) {
    ctx.body += `Sitemap: ${site}/sitemap.index.google.news.${n}.xml`

    if (googleLimit !== GOOGLE_LIMIT) {
      ctx.body += `?limit=${googleLimit}`
    }

    ctx.body += '\n'
  }

  for (let n = 1; n <= imageSitemapIndexCount; n++) {
    ctx.body += `Sitemap: ${site}/sitemap.index.google.image.${n}.xml`

    if (googleLimit !== GOOGLE_LIMIT) {
      ctx.body += `?limit=${googleLimit}`
    }

    ctx.body += '\n'
  }

  for (let n = 1; n <= videoSitemapIndexCount; n++) {
    ctx.body += `Sitemap: ${site}/sitemap.index.google.video.${n}.xml`

    if (googleLimit !== GOOGLE_LIMIT) {
      ctx.body += `?limit=${googleLimit}`
    }

    ctx.body += '\n'
  }
}

async function _sitemapIndex(ctx, type) {
  const MAX = type === 'normal' ? PAGE_LIMIT : GOOGLE_LIMIT
  const site = ctx.state.origin
  const limit = ctx.queries.int('limit', { defaults: MAX })
  checkLimitParam(limit, MAX)
  const page = ctx.params.int('page', { defaults: 1 })
  checkPageParam(page)
  const query = { site }

  if (type === 'news') {
    query['news.publication_date'] = { $gte: twoDaysAgo() }
  } else if (type === 'image') {
    query.hasImages = true
  } else if (type === 'video') {
    query.hasVideos = true
  }

  const options = {
    skip: (page - 1) * limit * PAGE_LIMIT,
    limit: limit * PAGE_LIMIT
  }

  logger.debug('count sitemaps', query, options)
  const docCount = await mongo.db.collection('sitemaps').countDocuments(query, options)

  if (docCount) {
    ctx.set('Content-Type', 'text/xml; charset=utf-8')
    ctx.set('Cache-Control', `max-age=${config.cache.sitemap}`)
    const stream = new PassThrough()
    ctx.body = stream
    stream.write('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    let prefix

    if (type === 'normal') {
      prefix = site + '/sitemap'
    } else if (type === 'google') {
      prefix = site + '/sitemap.google'
    } else {
      prefix = site + '/sitemap.google.' + type
    }

    const start = (page - 1) * limit
    const pageCount = Math.ceil(docCount / limit)

    for (let n = 1; n <= pageCount; n++) {
      stream.write(`<sitemap><loc>${prefix}.${start + n}.xml`)

      if (limit !== MAX) {
        stream.write(`?limit=${limit}`)
      }

      stream.write('</loc></sitemap>')
    }

    stream.end('</sitemapindex>')
  }
}

function sitemapIndex(ctx) {
  return _sitemapIndex(ctx, 'normal')
}

function googleSitemapIndex(ctx) {
  return _sitemapIndex(ctx, 'google')
}

function googleNewsSitemapIndex(ctx) {
  return _sitemapIndex(ctx, 'news')
}

function googleImageSitemapIndex(ctx) {
  return _sitemapIndex(ctx, 'image')
}

function googleVideoSitemapIndex(ctx) {
  return _sitemapIndex(ctx, 'video')
}

module.exports = {
  robotsTxt,
  sitemap,
  googleSitemap,
  googleSitemapItem,
  googleNewsSitemap,
  googleImageSitemap,
  googleVideoSitemap,
  sitemapIndex,
  googleSitemapIndex,
  googleNewsSitemapIndex,
  googleImageSitemapIndex,
  googleVideoSitemapIndex
}
