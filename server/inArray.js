module.exports = function(arr, val) {
  return arr.some(v => v instanceof RegExp ? v.test(val) : v === val)
}
