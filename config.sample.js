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
    poolSize: 5
  },

  cache: {
    maxAge: 3 * 60, // 3 minutes
    maxStale: 3 * 60 // 3 minutes
  },

  sentry: {
    dsn: ''
  },

  loglevel: 'debug' // debug, info, warning, error, fatal
}
