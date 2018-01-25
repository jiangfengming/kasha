const TIMEOUT = 20 * 1000
const queue = []

setInterval(() => {
  const now = Date.now()

  while (queue.length) {
    const q = queue[0]

    if (!q.ctx) { // has been consumed
      queue.shift()
    } else if (q.date + TIMEOUT > now) {
      break
    } else { // timed out
      q.reject(new CustomError('SERVER_WORKER_TIMEOUT'))
      queue.shift()
    }
  }
}, 1000)

function add(q) {
  return new Promise((resolve, reject) => {
    queue.push({ ...q, resolve, reject })
  })
}

function consume(msg) {
  const q = queue.find(q => q.correlationId === msg.properties.correlationId)
  if (!q) return

  const { ctx, resolve, reject, proxy, followRedirect } = q
  const code = msg.properties.headers.code
  const result = JSON.parse(msg.content.toString())

  if (code !== 'OK') {
    reject(new CustomError(result))
  } else {
    const { status, redirect, content } = result

    if (proxy) {
      if (redirect && !followRedirect) {
        ctx.status = status
        ctx.redirect(redirect)
      } else {
        ctx.status = status
        ctx.body = content || ''
      }
    } else {
      ctx.body = result
    }

    // release resource
    for (const k in q) delete q[k]
    resolve()
  }
}

module.exports = { add, consume }
