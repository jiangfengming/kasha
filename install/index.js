async function main() {
  const Schema = require('schema-upgrade')
  const db = await require('../shared/db').connect()
  const collection = db.collection('appInfo')
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
    await db.collection('snapshot').createIndex({ site: 1, path: 1, deviceType: 1 }, { unique: true })
    await db.collection('robotsTxt').createIndex({ site: 1 }, { unique: true })
  })

  schema.version(2, async db => {
    const sitemap = db.collection('sitemap')
    await sitemap.createIndex({ site: 1, path: 1 }, { unique: true })
    await sitemap.createIndex({ date: -1 })
  })

  if (!schema.needUpgrade()) return

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

  const latest = schema.latest()

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

  console.log('Database schema upgraded to version ' + latest) // eslint-disable-line
}

module.exports = main()
