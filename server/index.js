(async() => {
  const Koa = require('koa')
  const Router = require('koa-router')
  const amqp = require('amqplib')
  const CustomError = require('../shared/errors/CustomError')

  const configFile = process.env.npm_config_config || 'default'
  console.log('load config file:', configFile) // eslint-disable-line
  const config = require('../config/' + configFile)

  global.mq = {}
  mq.connection = await amqp.connect(config.amqp.url)
  mq.channel = await mq.connection.createConfirmChannel()
  mq.queue = await mq.channel.assertQueue('', { exclusive: true })

  const app = new Koa()
  const router = new Router()
  const { render } = require('./controller')

  router.get('/render', render)

  app.use(async(ctx, next) => {
    try {
      await next()
    } catch (e) {
      if (e instanceof CustomError) {
        const httpStatusMap = { CLIENT: 400, SERVER: 500 }
        ctx.status = httpStatusMap[e.code.split('_')[0]]
        ctx.body = {
          code: e.code,
          message: e.message
        }
      } else {
        console.error(e) // eslint-disable-line

        ctx.status = 500
        ctx.body = {
          code: 'SERVER_UNEXPECTED_ERROR',
          message: 'Unexpected error happened.'
        }
      }
    }
  })

  app.use(router.routes())

  app.listen(config.port)
  console.log(`http server started at port ${config.port}`) // eslint-disable-line
})()
