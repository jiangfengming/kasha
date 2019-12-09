const { MongoClient } = require('mongodb')
const logger = require('./logger')

const singleton = {
  mongoClient: null,
  db: null,

  async connect(url, database, options = {}) {
    if (singleton.db) {
      return singleton.db
    }

    options.useNewUrlParser = true
    options.useUnifiedTopology = true

    logger.warn('Conntecting to MongoDB...')
    singleton.mongoClient = await new MongoClient(url, options).connect()
    singleton.db = await singleton.mongoClient.db(database)
    logger.warn('MongoDB connected')

    return singleton.db
  },

  async close() {
    if (!singleton.mongoClient) {
      return
    }

    logger.warn('Closing MongoDB connection...')
    await singleton.mongoClient.close()
    logger.warn('MongoDB connection closed.')

    singleton.mongoClient = null
    singleton.db = null
  }
}

module.exports = singleton
