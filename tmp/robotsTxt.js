async function main() {
  await require('../shared/db').connect()
  const { isAllowed } = require('../worker/robotsTxt')
  console.log(await isAllowed('https://www.bing.com/foo'))
}

main()
