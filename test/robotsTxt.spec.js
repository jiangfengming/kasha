const assert = require('assert')

describe('robotsTxt', () => {
  let isAllowed

  before(async() => {
    await require('../shared/db').connect()
    isAllowed = require('../worker/robotsTxt').isAllowed
  })

  describe('#isAllowed()', () => {
    it('should allow: https://www.bing.com/foo', async() => {
      assert.deepEqual(await isAllowed('https://www.bing.com/foo'), true)
    })

    it('should disallow: https://www.bing.com/account/', async() => {
      assert.deepEqual(await isAllowed('https://www.bing.com/account/'), false)
    })

    it('should allow if no valid robots.txt exists: http://www.example.com/foo', async() => {
      assert.deepEqual(await isAllowed('http://www.example.com/foo'), true)
    })
  })
})
