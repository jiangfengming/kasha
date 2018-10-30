const errors = require('./errors')
const errorFactory = require('rest-api-error-factory')

module.exports = errorFactory(errors)
