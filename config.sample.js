module.exports = {
  // The listen port of the http server
  port: 3000,

  // Request with this host header is served in API mode.
  // If not set or set to falsy values, API mode is disabled.
  apiHost: '127.0.0.1:3000',
  // apiHost: ['127.0.0.1:3000', 'kasha.example.com']

  // enable debug page of API service
  // for example: http://127.0.0.1:3000/
  enableDebugPage: true,

  disallowUnknownHost: false,

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
    // if a resource exceeds maxage but in sMaxage,
    // it will be returned and the resource will be refreshed in background.
    sMaxage: 24 * 60 * 60, // 1 day

    // if we failed to refresh the resource or response status code >= 400,
    // we return the stale resource / error response and set Expires header after N seconds.
    maxStale: 10, // 10 seconds

    // max-age of robots.txt file
    robotsTxt: 24 * 60 * 60, // 1 day

    // max-age of sitemaps
    sitemap: 60 * 60, // 1 hour

    removeAfter: 24 * 60 * 60 // 1 day
  },

  // You can comment out `sites` config here, and store the sites config in db's `sites` collection.
  sites: [
    {
      host: 'localhost:3000',
      defaultProtocol: 'http',
      defaultProfile: null,

      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/69.0.3494.0 Safari/537.36',

      rewrites: [
        ['localhost:3000', 'www.example.com']
      ],

      excludes: [
        /\/accounts\/.*/
      ],

      includes: [
        '/accounts/login'
      ],

      profiles: {
        desktop: {
          userAgent: null,
          rewrites: null,
          excludes: null,
          includes: null
        }
      }
    }
  ],

  // Sentry error tracking
  // https://sentry.io/
  /*
  sentry: {
    dsn: 'https://<key>@sentry.io/<project>'
  },
  */

  chromiumPath: '',

  logLevel: 'log' // critical, fatal, error, warning, info, log, debug
}
