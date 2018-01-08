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
  const controller = require('./controller')

  // routes
  router.get('/render', controller.render)
  router.get('/cache', controller.cache)
  router.get('/(http.+)', controller.proxy)

  app.use(async(ctx, next) => {
    try {
      await next()
    } catch (e) {
      if (e instanceof CustomError) {
        ctx.status = e.status
        ctx.body = {
          code: e.code,
          message: e.message
        }
      } else {
        const { timestamp, eventId } = logger.error(e)
        const err = new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
        ctx.status = err.status
        ctx.body = {
          code: err.code,
          message: err.message
        }
      }
    }
  })

  app.use(router.routes())

  app.listen(config.port)
  logger.info(`http server started at port ${config.port}`)
})()
