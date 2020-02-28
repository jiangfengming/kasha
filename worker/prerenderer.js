const config = require('../lib/config')
const logger = require('../lib/logger')
const Prerenderer = require('puppeteer-prerender')

const options = {
  debug: config.logLevel === 'debug' ? logger.debug.bind(logger) : false,

  puppeteerLaunchOptions: {
    headless: global.argv.headless,
    executablePath: global.argv.chromiumPath || config.chromiumPath || undefined,

    args: [
      // '--no-sandbox',
      // '--disable-setuid-sandbox',
      // '--disable-dev-shm-usage',

      // https://github.com/alixaxel/chrome-aws-lambda/blob/master/source/index.js#L58
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-cloud-import',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gesture-typing',
      '--disable-hang-monitor',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-offer-upload-credit-cards',
      '--disable-popup-blocking',
      '--disable-print-preview',
      '--disable-prompt-on-repost',
      '--disable-setuid-sandbox',
      '--disable-speech-api',
      '--disable-sync',
      '--disable-tab-for-desktop-share',
      '--disable-translate',
      '--disable-voice-input',
      '--disable-wake-on-wifi',
      '--disk-cache-size=33554432',
      '--enable-async-dns',
      '--enable-simple-cache-backend',
      '--enable-tcp-fast-open',
      '--enable-webgl',
      '--hide-scrollbars',
      '--ignore-gpu-blacklist',
      '--media-cache-size=33554432',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--password-store=basic',
      '--prerender-from-omnibox=disabled',
      '--use-gl=swiftshader',
      '--use-mock-keychain',
      '--memory-pressure-off'
    ]
  },

  parseOpenGraphOptions: {
    // these tag has attributes
    alias: {
      'sitemap:video:player_loc': 'sitemap:video:player_loc:_',
      'sitemap:video:restriction': 'sitemap:video:restriction:_',
      'sitemap:video:platform': 'sitemap:video:platform:_',
      'sitemap:video:price': 'sitemap:video:price:_',
      'sitemap:video:uploader': 'sitemap:video:uploader:_'
    },

    arrays: [
      'sitemap:image',
      'sitemap:video',
      'sitemap:video:tag'
    ]
  }
}

module.exports = new Prerenderer(options)
