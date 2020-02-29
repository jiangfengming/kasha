const Router = require('url-router')

module.exports = function pathInList(list, path) {
  return Boolean(
    list &&
    list.length &&
    new Router(list.map(v => [v, true])).find(path)
  )
}
