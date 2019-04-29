const { URL } = require('url')
const mongo = require('../lib/mongo')
const removeXMLInvalidChars = require('./removeXMLInvalidChars')

module.exports = (site, path, doc) => {
  /*
  sitemaps schema:
  site: String
  path: String
  lastmod: String
  changefreq: String
  priority: String
  news: Array
  images: Array
  videos: Array
  updatedAt: Date
  */
  const sitemaps = mongo.db.collection('sitemaps')

  // sitemap
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

    return sitemaps.updateOne({
      site: canonicalURL.origin,
      path: canonicalURL.pathname + canonicalURL.search
    }, {
      $set: {
        ...sitemap,
        updatedAt: new Date()
      }
    }, { upsert: true })
  } else {
    return sitemaps.deleteOne({ site, path })
  }
}
