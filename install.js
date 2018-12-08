const Schema = require('schema-upgrade')
const config = require('./shared/config')
const logger = require('./shared/logger')
const mongo = require('./shared/mongo')

async function install() {
  const db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
  const meta = db.collection('meta')
  const sites = db.collection('sites')
  const snapshots = db.collection('snapshots')
  const sitemaps = db.collection('sitemaps')

  logger.info('Checking current database schema version...')
  let appInfo = await meta.findOne({ key: 'appInfo' })

  if (!appInfo) {
    logger.info('Database doesn\'t exist. Initialized...')
    appInfo = {
      key: 'appInfo',
      version: 0,
      upgrading: false
    }

    await meta.createIndex({ key: 1 }, { unique: true })
    await meta.insertOne(appInfo)
  }

  const schema = new Schema(db, appInfo.version)

  schema.version(1, async() => {
    logger.info('Upgrading database schema to version 1...')
    await sites.createIndex({ host: 1, default: -1 }, { unique: true })
    await snapshots.createIndex({ site: 1, path: 1, deviceType: 1 }, { unique: true })
    await sitemaps.createIndex({ site: 1, path: 1 }, { unique: true })
    await sitemaps.createIndex({ 'news.publication_date': -1 })
    logger.info('Upgraded to database schema version 1.')
  })

  schema.version(2, async() => {
    logger.info('Upgrading database schema to version 2...')
    await snapshots.createIndex({ sharedExpires: 1 })
    await meta.insertOne({
      key: 'cacheClean',
      cronTime: null,
      cleaning: false,
      cleaningAt: null,
      nextAt: null
    })
    logger.info('Upgraded to database schema version 2.')
  })

  schema.version(3, async() => {
    logger.info('Upgrading database schema to version 3...')
    await sitemaps.createIndex({ site: 1, 'news.publication_date': -1 })
    await sitemaps.dropIndex({ 'news.publication_date': -1 })
    await sitemaps.createIndex({ site: 1, hasImages: 1 })
    await sitemaps.createIndex({ site: 1, hasVideos: 1 })
    await sitemaps.updateMany({ image: { $exists: true } }, { $set: { hasImages: true } })
    await sitemaps.updateMany({ video: { $exists: true } }, { $set: { hasVideos: true } })
    logger.info('Upgraded to database schema version 3.')
  })

  const latest = schema.latest()

  if (latest === appInfo.version) {
    logger.info('Database schema is up to date.')
    return
  }

  logger.info(`Upgrade database schema from verion ${appInfo.version} to ${latest}.`)

  logger.info('Setting upgrade lock...')
  const result = await meta.updateOne({
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

  logger.info('Releasing upgrade lock...')
  await meta.updateOne({
    key: 'appInfo',
    version: appInfo.version,
    upgrading: true
  }, {
    $set: {
      version: latest,
      upgrading: false
    }
  })
  logger.info('Database schema upgraded successfully.')
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
