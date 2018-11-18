const { MongoClient } = require('mongodb')

const singleton = {
  // after the entry point function has initialized the db connection via:
  // const db = await require('./mongo').connect(url, database, options)
  // other modules can import db instance without await:
  // const { db } = require('./mongo')
  mongoClient: null,
  db: null,

  async connect(url, database, options = {}) {
    if (singleton.db) return singleton.db

    options.useNewUrlParser = true
    singleton.mongoClient = await new MongoClient(url, options).connect()
    singleton.db = await singleton.mongoClient.db(database)
    return singleton.db
  },

  async close() {
    if (!singleton.mongoClient) return

    await singleton.mongoClient.close()
    singleton.mongoClient = null
    singleton.db = null
  }
}

module.exports = singleton
