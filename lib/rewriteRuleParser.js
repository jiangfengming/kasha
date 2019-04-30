function unescape(rules) {
  return rules && rules.map(([type, search, replace]) => {
    if (type === 'regexp') {
      const lastSlash = search.lastIndexOf('/')
      search = new RegExp(search.slice(1, lastSlash), search.slice(lastSlash + 1))
    }

    return [search, replace]
  })
}

function escape(rules) {
  return rules && rules.map(
    ([search, replace]) =>
      search.constructor === RegExp ? ['regexp', search.toString(), replace] : ['string', search, replace]
  )
}

module.exports = { escape, unescape }
