module.exports = function(a, b) {
  if (b == null) {
    return a
  }

  if (b.constructor === Boolean) {
    return b
  }

  if (b.constructor === Array) {
    if (a == null || a.constructor !== Array) {
      return b
    }

    return [...a, ...b]
  }
}
