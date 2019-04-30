const { URL } = require('url')
const mongo = require('../lib/mongo')
const logger = require('../lib/logger')
const removeXMLInvalidChars = require('./removeXMLInvalidChars')
const validHTTPStatus = require('./validHTTPStatus')

module.exports = (site, path, doc) => {
  /*
  schema:

  site: String
  path: String
  lastmod: String
  changefreq: String
  priority: String
  news: Array
  images: Array
  videos: Array
  failed: Number
  updatedAt: Date
  */
  const sitemaps = mongo.db.collection('sitemaps')

  let canonicalURL

  if (doc.meta && doc.meta.canonicalURL) {
    try {
      canonicalURL = new URL(doc.meta.canonicalURL)
    } catch (e) {
      // nop
    }
  }

  if (canonicalURL && canonicalURL.origin === site) {
    let sitemap = {}

    if (doc.openGraph) {
      if (doc.openGraph.sitemap) sitemap = doc.openGraph.sitemap

      if (sitemap.news) {
        const date = new Date(sitemap.news.publication_date)

        if (!sitemap.news.title || isNaN(date.getTime())) {
          delete sitemap.news
        } else {
          sitemap.news.title = removeXMLInvalidChars(sitemap.news.title)
          sitemap.news.publication_date = date
        }
      }

      if (!sitemap.image && doc.openGraph.og && doc.openGraph.og.image) {
        sitemap.image = []

        for (const img of doc.openGraph.og.image) {
          sitemap.image.push({
            loc: img.secure_url || img.url
          })
        }
      }
    }

    if (!sitemap.lastmod && doc.meta.lastModified) {
      const date = new Date(doc.meta.lastModified)

      if (!isNaN(date.getTime())) {
        sitemap.lastmod = date.toISOString()
      }
    }

    return sitemaps
      .updateOne(
        {
          site: canonicalURL.origin,
          path: canonicalURL.pathname + canonicalURL.search
        },

        {
          $set: {
            ...sitemap,
            failed: 0,
            updatedAt: new Date()
          }
        },

        {
          upsert: true
        }
      )
      .catch(e => logger.error(e))
  }

  if (validHTTPStatus.includes(doc.status)) {
    return sitemaps.deleteOne({ site, path }).catch(e => logger.error(e))
  }

  return sitemaps
    .updateOne({ site, path }, {
      $inc: {
        failed: 1
      }
    })
    .then(() => sitemaps.deleteOne({ site, path, failed: { $gt: 3 } }))
    .catch(e => logger.error(e))
}
