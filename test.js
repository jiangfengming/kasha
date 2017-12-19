console.log(require('yargs').argv)

/* async function main() {
  const { MongoClient } = require('mongodb')
  const client = await MongoClient.connect('mongodb://localhost:27017/renderService')
  const db = client.db('renderService')
  const result = await db.collection('cache').findOne({ a: 1 })
  console.log(result)
}

main()
 */
