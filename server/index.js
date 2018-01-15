(async() => {
  const Koa = require('koa')
  const Router = require('koa-router')
  const amqp = require('amqplib')
  const { MongoClient } = require('mongodb')

  // global error class
  global.CustomError = require('../shared/CustomError')

  // load config
  const config = require('../shared/config')

  // global logger
  global.logger = require('../shared/logger')

  // global RabbitMQ instance
  global.mq = {}
  mq.connection = await amqp.connect(config.amqp.url)
  mq.channel = await mq.connection.createConfirmChannel()
  mq.queue = await mq.channel.assertQueue('', { exclusive: true })

  // global MongoDB instance
  global.mongoClient = await MongoClient.connect(config.mongodb.url)
  global.db = mongoClient.db(config.mongodb.database)

  // server
  const app = new Koa()
  const router = new Router()
  const render = require('./render')

  // routes
  router.get('/render', render)

  router.get('/cache', (ctx, next) => {
    ctx.query.noWait = true
    return next()
  }, render)

  router.get('/(http.+)', (ctx, next) => {
    ctx.query.url = ctx.url.slice(1)
    return next()
  }, render)

  app.use(async(ctx, next) => {
    try {
      await next()
    } catch (e) {
      let err = e
      if (!(e instanceof CustomError)) {
        const { timestamp, eventId } = logger.error(e)
        err = new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }

      ctx.status = err.status
      ctx.body = err.toJSON()
    }
  })

  app.use(router.routes())

  app.listen(config.port)
  logger.info(`http server started at port ${config.port}`)
})()
