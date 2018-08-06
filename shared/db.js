const { MongoClient } = require('mongodb')

const me = {
  // after the entry point function has initialized the db connection via:
  // const db = await require('./db').connect(options)
  // other modules can import db instance without await:
  // const { db } = require('./db')
  mongoClient: null,
  db: null,

  async connect({ url, database, options }) {
    if (me.db) return me.db

    options.useNewUrlParser = true

    me.mongoClient = await new MongoClient(url, options).connect()
    me.db = await me.mongoClient.db(database)
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
