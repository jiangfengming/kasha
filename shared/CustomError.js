const errors = require('./errors')

class CustomError extends Error {
  constructor(code, message = errors[code]) {
    super(message)
    this.code = code
  }
}

module.exports = CustomError
