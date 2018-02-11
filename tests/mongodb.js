async function main() {
  const { MongoClient } = require('mongodb')
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db('kasha')
  const result = await db.collection('snapshot').findOne({ error: null })
  console.log(result)
}

main()
