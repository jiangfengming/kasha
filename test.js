// console.log(require('yargs').argv)
/*
async function main() {
  const { MongoClient } = require('mongodb')
  const client = await MongoClient.connect('mongodb://localhost:27017/test')
  const db = client.db('test')
  const result = await db.collection('test').findOne()
  console.log(JSON.stringify(result)
}

main()
 */
/*
const e = new Error('aaaa')
e.foo = 111
console.error(e)
console.error({ bar: 222 })
 */

const Logger = require('./shared/Logger')
const logger = new Logger()
logger.info('hello')
