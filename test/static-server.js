
const Koa = require('koa')
const Router = require('koa-router')
const serve = require('koa-static')

const app = new Koa()
const router = new Router()
router.get('/pending.js', async ctx => {
  await new Promise(resolve => setTimeout(resolve, 25000))
  ctx.type = 'js'
  ctx.body = 'document.body.innerHTML = "<p>Hello from js</p>"'
})

app.use(router.routes())
app.use(serve('.'))
app.listen(8080)
