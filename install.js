const Schema = require('schema-upgrade')
const config = require('../shared/config')
const logger = require('./shared/logger')
const mongo = require('./shared/mongo')

async function install() {
  const db = await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
  const metaColl = db.collection('meta')

  logger.info('Checking current database schema version...')
  let appInfo = await metaColl.findOne({ key: 'appInfo' })

  if (!appInfo) {
    logger.info('Database doesn\'t exist. Initialized...')
    appInfo = {
      key: 'appInfo',
      version: 0,
      upgrading: false
    }

    await metaColl.createIndex({ key: 1 }, { unique: true })
    await metaColl.insertOne(appInfo)
  }

  const schema = new Schema(db, appInfo.version)

  schema.version(1, async db => {
    logger.info('Upgrading database schema to version 1...')
    await db.collection('sites').createIndex({ host: 1, default: -1 }, { unique: true })
    await db.collection('snapshots').createIndex({ site: 1, path: 1, deviceType: 1 }, { unique: true })
    const sitemap = db.collection('sitemaps')
    await sitemap.createIndex({ site: 1, path: 1 }, { unique: true })
    await sitemap.createIndex({ 'news.publication_date': -1 })
    logger.info('Upgraded to database schema version 1.')
  })

  schema.version(2, async db => {
    logger.info('Upgrading database schema to version 2...')
    await db.collection('snapshots').createIndex({ sharedExpires: 1 })
    await metaColl.insertOne({
      key: 'cacheClean',
      cronTime: null,
      cleaningAt: null,
      nextAt: null
    })
    logger.info('Upgraded to database schema version 2.')
  })

  const latest = schema.latest()

  if (latest === appInfo.version) {
    logger.info('Database schema is up to date.')
    return
  }

  logger.info(`Upgrade database schema from verion ${appInfo.version} to ${latest}.`)

  logger.info('Setting upgrade lock...')
  const result = await metaColl.updateOne({
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
  await metaColl.updateOne({
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
