module.exports = {
  // The listen port of the http server
  port: 3000,

  // Request with this host header is served in API mode.
  // If not set or set to falsy values, API mode is disabled.
  apiHost: '127.0.0.1:3000',
  // apiHost: ['127.0.0.1:3000', 'kasha.example.com']

  // enable homepage of API service
  // for example: http://127.0.0.1:3000/
  enableHomepage: true,

  nsq: {
    // Options: https://github.com/dudleycarr/nsqjs#new-readertopic-channel-options
    reader: {
      // lookupdHTTPAddresses: '127.0.0.1:4161'
      // lookupdHTTPAddresses: ['10.0.0.142:4161','10.0.0.155:4161','10.0.0.4:4161']
      nsqdTCPAddresses: '127.0.0.1:4150',
      maxInFlight: 10
    },

    // Options: https://github.com/dudleycarr/nsqjs#new-writernsqdhost-nsqdport-options
    writer: {
      host: '127.0.0.1',
      port: 4150,
      options: {}
    }
  },

  mongodb: {
    // MongoDB connection URL
    url: 'mongodb://localhost:27017',

    // Database name
    database: 'kasha',

    // MongoClient options for http server
    // http://mongodb.github.io/node-mongodb-native/3.1/api/MongoClient.html
    serverOptions: {
      poolSize: 10
    },

    // MongoClient options for worker
    workerOptions: {
      poolSize: 2
    }
  },

  // The unit of time is in seconds
  cache: {
    // default max-age header of resources.
    maxage: 3 * 60, // 3 minutes

    // how long to cache the resources by default.
    // if a resource exceeds maxage but in sMaxage, it will be returned and the resource will be refreshed in background.
    sMaxage: 24 * 60 * 60, // 1 day

    // max-age header of stale resources.
    // if we failed to refresh the resource, we return the stale resource and set max-age to maxStale seconds.
    maxStale: 10, // 10 seconds

    // max-age of robots.txt file
    robotsTxt: 24 * 60 * 60, // 1 day

    // max-age of sitemaps
    sitemap: 60 * 60, // 1 hour

    autoClean: '0 0 * * *' // At 00:00 every day
  },

  // You can comment out `sites` config here, and store the sites config in db's `sites` collection.
  sites: [
    {
      host: 'localhost:3000',
      protocol: 'https',
      rewrites: [
        ['localhost:3000', 'www.example.com']
      ],
      includes: [
        '/',
        /\/articles\/\d+/
      ],
      excludes: [
        /\/accounts\/.*/
      ],
      waitForVariable: 'PAGE_READY'
    }
  ],

  // Sentry error tracking
  // https://sentry.io/
  /*
  sentry: {
    dsn: 'https://<key>@sentry.io/<project>'
  },
  */

  logLevel: 'log' // critical, fatal, error, warning, info, log, debug
}
