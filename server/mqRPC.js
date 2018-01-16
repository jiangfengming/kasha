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

  const { ctx, resolve, reject } = q
  console.log(msg.properties.headers.status) // eslint-disable-line
  const status = +msg.properties.headers.status
  const result = JSON.parse(msg.content.toString())

  if (status !== 200) {
    reject(new CustomError(result))
  } else {
    ctx.body = result
    Object.assign(q, { ctx: null, correlationId: null, date: null, resolve: null, reject: null })
    resolve()
  }
}

module.exports = { add, consume }
