async function main() {
  const VERSION_LATEST = 1

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

  await collection.updateOne({
    key: 'appInfo',
    version: appInfo.version,
    upgrading: true
  }, {
    $set: {
      version: VERSION_LATEST,
      upgrading: false
    }
  })

  console.log('Database schema upgraded to version ' + VERSION_LATEST) // eslint-disable-line
}

module.exports = main()
