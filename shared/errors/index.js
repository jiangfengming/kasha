const CustomError = require('./CustomError')
const errors = require('./errors')

for (const e of errors) {
  exports[e[0]] = new CustomError(...e)
}
