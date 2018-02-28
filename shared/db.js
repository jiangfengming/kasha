const { MongoClient } = require('mongodb')
const { mongodb: options } = require('./config')

const singleton = {
  // after the entry point function has initialized the db connection via:
  // const db = await require('./db').connect()
  // other modules can import db instance without await:
  // const { db } = require('./db')
  db: null,

  async connect() {
    if (singleton.db) return singleton.db

    const opts = {}
    if (options.poolSize) opts.poolSize = options.poolSize

    const mongoClient = await new MongoClient(options.url, opts).connect()
    singleton.db = await mongoClient.db(options.database)
    return singleton.db
  }
}

module.exports = singleton
