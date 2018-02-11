#!/usr/bin/env node

(async() => {
  const config = require('../shared/config')
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')

  await require('../shared/db')

  const Koa = require('koa')
  const Router = require('koa-router')

  const app = new Koa()
  const router = new Router()
  const render = require('./render')

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

  app.listen(config.port)
  logger.info(`http server started at port ${config.port}`)
})()
