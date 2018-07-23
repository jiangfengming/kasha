const { MongoClient } = require('mongodb')
const { mongodb: options } = require('./config')

const me = {
  // after the entry point function has initialized the db connection via:
  // const db = await require('./db').connect()
  // other modules can import db instance without await:
  // const { db } = require('./db')
  mongoClient: null,
  db: null,

  async connect() {
    if (me.db) return me.db

    const opts = {
      useNewUrlParser: true
    }

    if (options.poolSize) opts.poolSize = options.poolSize

    me.mongoClient = await new MongoClient(options.url, opts).connect()
    me.db = await me.mongoClient.db(options.database)
    return me.db
  },

  async close() {
    if (!me.db) return

    await me.mongoClient.close()
    me.mongoClient = null
    me.db = null
  }
}

module.exports = me
