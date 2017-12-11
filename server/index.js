(async() => {
  const Koa = require('koa')
  const Router = require('koa-router')
  const amqp = require('amqplib')

  const configFile = process.env.npm_config_config || 'default'
  console.log('load config file:', configFile)
  const config = require('./config/' + configFile)

  const conn = await amqp.connect(config.amqp.url)
  global.channel = await conn.createChannel()
  global.queue = await chan.assertQueue('', { exclusive: true })

  const app = new Koa()
  const router = new Router()
  const { render } = require('./controller')

  router.get('/render', render)

  app.use(router.routes())

  app.listen(config.port)
  console.log(`http server started at port ${config.port}`) // eslint-disable-line
})()
