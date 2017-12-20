const errors = require('./errors')
const { format } = require('util')

class CustomError extends Error {
  constructor(code, ...args) {
    super(format(errors[code], ...args))
    this.code = code
  }
}

module.exports = CustomError
