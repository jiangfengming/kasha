async function main() {
  const Schema = require('schema-upgrade')
  const db = require('../shared/db').connect()

  const schema = new Schema(db)

  schema.version(1, db => {

  })

  schema.upgrade()
}

main()
