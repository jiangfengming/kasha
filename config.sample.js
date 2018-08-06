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
    server: {
      url: 'mongodb://localhost:27017',
      database: 'kasha',
      options: {
        poolSize: 10
      }
    },

    worker: {
      url: 'mongodb://localhost:27017',
      database: 'kasha',
      options: {
        poolSize: 2
      }
    }
  },

  cache: {
    maxAge: 3 * 60, // 3 minutes
    maxStale: 24 * 60 * 60 // 1 day
  },

  sentry: {
    dsn: ''
  },

  loglevel: 'debug' // debug, info, warning, error, fatal
}
