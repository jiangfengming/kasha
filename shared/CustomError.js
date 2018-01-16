const errors = require('./errors')
const { format } = require('util')

const httpStatusMap = { CLIENT: 400, SERVER: 500 }

class CustomError extends Error {
  constructor(code, ...args) {
    if (code.constructor === Object) {
      super(code.message)
      this.code = code.code
    } else {
      super(format(errors[code], ...args))
      this.code = code
    }

    this.status = httpStatusMap[this.code.split('_')[0]]
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message
    }
  }
}

module.exports = CustomError
