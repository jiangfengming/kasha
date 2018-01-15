const errors = require('./errors')
const { format } = require('util')

class CustomError extends Error {
  constructor(code, ...args) {
    super(format(errors[code], ...args))
    this.code = code

    const httpStatusMap = { CLIENT: 400, SERVER: 500 }
    this.status = httpStatusMap[code.split('_')[0]]
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message
    }
  }
}

module.exports = CustomError
