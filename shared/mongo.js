const { MongoClient } = require('mongodb')
const config = require('./shared/config')
const logger = require('./logger')

const singleton = {
  // after the entry point function has initialized the db connection via:
  // const db = await require('./mongo').connect()
  // other modules can import db instance without await:
  // const { db } = require('./mongo')
  mongoClient: null,
  db: null,

  async connect() {
    if (singleton.db) return singleton.db

    const options = { ...config.mongodb.options, useNewUrlParser: true }

    logger.info('Conntecting to MongoDB...')
    singleton.mongoClient = await new MongoClient(config.mongodb.url, options).connect()
    singleton.db = await singleton.mongoClient.db(config.mongodb.database)
    logger.info('MongoDB connected')

    return singleton.db
  },

  async close() {
    if (!singleton.mongoClient) return

    logger.info('Closing MongoDB connection...')
    await singleton.mongoClient.close()
    logger.info('MongoDB connection closed.')

    singleton.mongoClient = null
    singleton.db = null
  }
}

module.exports = singleton
