const Schema = require('schema-upgrade')
const config = require('./lib/config')
const logger = require('./lib/logger')
const mongo = require('./lib/mongo')

async function install() {
  await mongo.connect(config.mongodb.url, config.mongodb.database, config.mongodb.serverOptions)
  const meta = mongo.db.collection('meta')
  const sites = mongo.db.collection('sites')
  const snapshots = mongo.db.collection('snapshots')
  const sitemaps = mongo.db.collection('sitemaps')

  logger.warn('Checking current database schema version...')
  let appInfo = await meta.findOne({ key: 'appInfo' })

  if (!appInfo) {
    logger.warn('Database doesn\'t exist. Initialized...')

    appInfo = {
      key: 'appInfo',
      version: 0,
      upgrading: false
    }

    await meta.createIndex({ key: 1 }, { unique: true })
    await meta.insertOne(appInfo)
  }

  const schema = new Schema(appInfo.version)

  schema.version(4, async() => {
    logger.warn('Upgrading database schema to version 4...')

    await sites.createIndex({ host: 1 }, { unique: true })

    await snapshots.createIndex({ removeAt: 1 }, { expireAfterSeconds: 0 })
    await snapshots.createIndex({ site: 1, path: 1, profile: 1 }, { unique: true })

    await sitemaps.createIndex({ site: 1, path: 1 }, { unique: true })
    await sitemaps.createIndex({ site: 1, 'news.publication_date': -1 })
    await sitemaps.createIndex({ site: 1, hasImages: 1 })
    await sitemaps.createIndex({ site: 1, hasVideos: 1 })

    logger.warn('Upgraded to database schema version 4.')
  })

  const latest = schema.latest()

  if (latest === appInfo.version) {
    logger.warn('Database schema is up to date.')
    return
  }

  logger.warn(`Upgrade database schema from verion ${appInfo.version} to ${latest}.`)

  logger.warn('Setting upgrade lock...')
  const result = await meta.updateOne(
    {
      key: 'appInfo',
      version: appInfo.version,
      upgrading: false
    },

    {
      $set: {
        upgrading: true
      }
    }
  )

  if (!result.modifiedCount) {
    throw new Error('Other process is upgrading the database. Please wait.')
  }

  await schema.upgrade()

  logger.warn('Releasing upgrade lock...')
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
  logger.warn('Database schema upgraded successfully.')
}

async function cli() {
  try {
    await install()
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  } finally {
    await mongo.close()
  }
}

module.exports = { install, cli }
