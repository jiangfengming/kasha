describe('robotsTxt', () => {
  let isAllowed

  before(async() => {
    await require('../shared/db').connect()
    isAllowed = require('../worker/robotsTxt').isAllowed
  })

  describe('#isAllowed()', () => {
    it('should allow: https://www.bing.com/foo', () => isAllowed('https://www.bing.com/foo'))
  })
})
