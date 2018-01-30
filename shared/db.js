const { MongoClient } = require('mongodb')
const { mongodb: options } = require('./config')

async function connect() {
  const opts = {}
  if (options.poolSize) opts.poolSize = options.poolSize

  const mongoClient = await new MongoClient(options.url, opts).connect()
  return mongoClient.db(options.database)
}

module.exports = connect()
