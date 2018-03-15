#!/usr/bin/env node

(async() => {
  await require('../install')

  const config = require('../shared/config')
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')

  const mongodb = require('../shared/db')
  await mongodb.connect()

  const nsqWriter = await require('../shared/nsqWriter').connect()
  const workerResponse = require('./workerResponse')

  const Koa = require('koa')
  const Router = require('koa-router')
  const stoppable = require('stoppable')

  const app = new Koa()
  const router = new Router()
  const render = require('./render')

  app.on('error', e => {
    logger.error(e)
  })

  app.use(async(ctx, next) => {
    try {
      await next()
      ctx.set('X-Code', 'OK')
    } catch (e) {
      let err = e
      if (!(e instanceof CustomError)) {
        const { timestamp, eventId } = logger.error(e)
        err = new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId)
      }
      ctx.set('X-Code', err.code)
      ctx.status = err.status
      ctx.body = err.toJSON()
    }
  })

  // routes
  router.get('/render', render)

  router.get('/cache', (ctx, next) => {
    ctx.query.noWait = ''
    return next()
  }, render)

  router.get('/(http.+)', (ctx, next) => {
    ctx.query = {
      url: ctx.url.slice(1),
      proxy: '',
      deviceType: ctx.headers['x-device-type'] || 'desktop'
    }
    return next()
  }, render)

  app.use(router.routes())

  const server = stoppable(app.listen(config.port))

  // graceful exit
  let stopping = false
  process.on('SIGINT', async() => {
    if (stopping) return

    stopping = true
    logger.info('Closing the server. Please wait for finishing the pending requests.')

    server.stop(async() => {
      clearInterval(workerResponse.interval)
      workerResponse.reader.close()
      nsqWriter.close()
      await mongodb.close()
    })
  })

  logger.info(`http server started at port ${config.port}`)
})()
