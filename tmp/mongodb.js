async function main() {
  const { MongoClient } = require('mongodb')
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db('test')
  try {
    const result = await db.collection('test').updateOne({ foo: 1, bar: 3 }, { $set: { bar: 2 } }, { upsert: true })
    console.log(result)
  } catch (e) {
    console.log(e)
  }
}

main()
