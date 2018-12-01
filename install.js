const Schema = require('schema-upgrade')
const config = require('../shared/config')
const logger = require('../shared/logger')

async function install() {
  const db = await require('../shared/mongo').connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)

  let appInfo = await db.collection('meta').findOne({ key: 'appInfo' })
  if (!appInfo) {
    appInfo = {
      key: 'appInfo',
      version: 0,
      upgrading: false
    }

    await db.collection('meta').createIndex({ key: 1 }, { unique: true })
    await db.collection('meta').insertOne(appInfo)
  }

  const schema = new Schema(db, appInfo.version)

  schema.version(1, async db => {
    await db.collection('sites').createIndex({ host: 1, default: -1 }, { unique: true })
    await db.collection('snapshots').createIndex({ site: 1, path: 1, deviceType: 1 }, { unique: true })
    const sitemap = db.collection('sitemaps')
    await sitemap.createIndex({ site: 1, path: 1 }, { unique: true })
    await sitemap.createIndex({ 'news.publication_date': -1 })
  })

  schema.version(2, async db => {
    await db.collection('snapshots').createIndex({ sharedExpires: 1 })
    await db.collection('meta').insertOne({
      key: 'autoClean',
      cleaning: false,
      cronTime: null,
      nextAt: null
    })
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

  await schema.upgrade()

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

async function cli() {
  try {
    await install()
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
}

module.exports = { install, cli }
