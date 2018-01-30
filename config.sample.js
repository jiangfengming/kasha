module.exports = {
  port: 3000,

  amqp: {
    url: 'amqp://localhost'
  },

  parallelJobsPerWorker: 10,

  mongodb: {
    url: 'mongodb://localhost:27017',
    database: 'kasha',
    poolSize: 5
  },

  cache: 24 * 60, // 1 day

  sentry: {
    dsn: ''
  },

  loglevel: 'debug'
}
