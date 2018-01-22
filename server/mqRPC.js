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

  const { ctx, resolve, reject, format, followRedirect } = q
  console.log(msg.properties.headers.code) // eslint-disable-line
  const code = msg.properties.headers.code
  const result = JSON.parse(msg.content.toString())

  if (code !== 'OK') {
    reject(new CustomError(result))
  } else {
    if (format === 'json') {
      ctx.body = result
    } else {
      const isOK = status >= 200 && status <= 299
      const isRedirect = isOK ? false : [301, 302].includes(status)

      if (isOK || (isRedirect && followRedirect)) {
        ctx.body = result.content
      } else if (isRedirect) {
        ctx.status = result.status
        ctx.redirect(result.redirect)
      } else {

      }
    }

    // release resource
    for (const k in q) delete q[k]
    resolve()
  }
}

function handleResult(ctx, result, { format, followRedirect }) {
  const { status, redirect, content } = result
  const isOK = status >= 200 && status <= 299
  const isRedirect = isOK ? false : [301, 302].includes(status)

  if (isOK || isRedirect && (!followRedirect || followRedirect && content !== null)) {
    if (format === 'json') {
      ctx.body = result
    } else {
      if (isOK || followRedirect) {
        ctx.body = content
      } else {
        ctx.status = status
        ctx.redirect(redirect)
      }
    }

    return true
  } else {
    return false
  }
}

module.exports = { add, consume, handleResult }
