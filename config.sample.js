module.exports = {
  port: 3000,

  nsq: {
    reader: {
      // lookupdHTTPAddresses: '127.0.0.1:4161'
      nsqdTCPAddresses: '127.0.0.1:4150',
      maxInFlight: 10
    },

    writer: {
      host: '127.0.0.1',
      port: 4150,
      options: {}
    }
  },

  mongodb: {
    url: 'mongodb://localhost:27017',
    database: 'kasha',

    serverOptions: {
      poolSize: 10
    },

    workerOptions: {
      poolSize: 2
    }
  },

  cache: {
    // in seconds

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
    sitemap: 60 * 60 // 1 hour
  },

  sentry: {
    dsn: ''
  },

  loglevel: 'debug' // debug, info, warning, error, fatal
}
