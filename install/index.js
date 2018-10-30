async function main() {
  const Schema = require('schema-upgrade')
  const config = require('../shared/config')
  const db = await require('../shared/mongo').connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
  const collection = db.collection('meta')
  let appInfo = await collection.findOne({ key: 'appInfo' })

  if (!appInfo) {
    appInfo = {
      key: 'appInfo',
      version: 0,
      upgrading: false
    }

    await collection.createIndex({ key: 1 }, { unique: true })
    await collection.insertOne(appInfo)
  }

  const schema = new Schema(db, appInfo.version)

  schema.version(1, async db => {
    await db.collection('sites').createIndex({ host: 1, default: -1 }, { unique: true })
    await db.collection('snapshots').createIndex({ site: 1, path: 1, deviceType: 1 }, { unique: true })
    const sitemap = db.collection('sitemaps')
    await sitemap.createIndex({ site: 1, path: 1 }, { unique: true })
    await sitemap.createIndex({ 'news.publication_date': -1 })
  })

  const latest = schema.latest()

  if (latest === appInfo.version) return

  const result = await collection.updateOne({
    key: 'appInfo',
    version: appInfo.version,
    upgrading: false
  }, {
    $set: {
      upgrading: true
    }
  })

  if (!result.modifiedCount) {
    throw new Error('Other process is upgrading the database. Please wait.')
  }

  schema.upgrade()

  await collection.updateOne({
    key: 'appInfo',
    version: appInfo.version,
    upgrading: true
  }, {
    $set: {
      version: latest,
      upgrading: false
    }
  })
}

module.exports = main()
