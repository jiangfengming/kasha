async function main() {
  const config = require('./shared/config')
  const { MongoClient } = require('mongodb')
  global.mongoClient = await MongoClient.connect(config.mongodb.url)
  global.db = mongoClient.db(config.mongodb.database)

  const { isAllowed } = require('./worker/robotsTxt')
  const result = await isAllowed('https://wallstreetcn.com/')
  console.log(result)
}

main()

// console.log(require('yargs').argv)


/* async function main() {
  const { MongoClient } = require('mongodb')
  const client = await MongoClient.connect('mongodb://localhost:27017/test')
  const db = client.db('test')
  const result = await db.collection('test').findOne({ foo: 1 })
  console.log(result)
}

main() */


/*
const e = new Error('aaaa')
e.foo = 111
console.error(e)
console.error({ bar: 222 })
 */

/*
const logger = require('./shared/logger')
console.log(logger.fatal(new Error('fatal')))
console.log(logger.error(new Error('error')))
console.log(logger.warn('warn'))
console.log(logger.info('hello'))
console.log(logger.debug('debug'))
 */


/* const fetchRobots = require('./shared/fetchRobots')
fetchRobots('https://jianshiapp.com/robots.txt')
 */
