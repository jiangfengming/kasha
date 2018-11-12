const { Reader } = require('nsqjs')
const { hostname } = require('os')
const RESTError = require('../shared/RESTError')
const logger = require('../shared/logger')
const { nsq: { reader: options } } = require('../shared/config')
const reply = require('./reply')

module.exports = {
  topic: `kasha-server-${hostname()}`,
  maxInFlight: 2500,
  timeout: 28 * 1000,
  queue: [],

  connect() {
    this.reader = new Reader(this.topic, 'response', { ...options, maxInFlight: this.maxInFlight })

    this.reader.on('message', async msg => {
      // don't block the queue
      msg.finish()

      const data = msg.json()
      const req = this.queue.find(req => req.correlationId === data.correlationId)
      if (!req) return

      const { ctx, resolve, reject, type, followRedirect } = req

      if (data.error) return reject(new RESTError(data.error))

      data.doc.privateExpires = new Date(data.doc.privateExpires)
      data.doc.sharedExpires = new Date(data.doc.sharedExpires)

      reply(ctx, type, followRedirect, data.doc, data.cacheStatus)

      // release resources
      for (const k in req) delete req[k]

      resolve()
    })

    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.reader.removeListener('error', onError)
        this.reader.on('error', e => {
          logger.error('Worker responder error', e)
        })

        this.cleanUpInterval = setInterval(() => {
          const now = Date.now()

          while (this.queue.length) {
            const req = this.queue[0]

            if (!req.ctx) { // has been consumed
              this.queue.shift()
            } else if (req.date + this.timeout > now) {
              break
            } else { // timed out
              req.reject(new RESTError('SERVER_WORKER_TIMEOUT'))
              this.queue.shift()
            }
          }
        }, 1000)

        resolve()
      }

      const onError = () => {
        this.reader.removeListener('ready', onReady)
        reject()
      }

      this.reader.once('ready', onReady)
      this.reader.once('error', onError)
      this.reader.connect()
    })
  },

  close() {
    clearInterval(this.cleanUpInterval)

    return new Promise((resolve, reject) => {
      if (this.reader.connectionIds.length === 0) {
        return resolve()
      }

      this.reader.on('nsqd_closed', () => {
        if (this.reader.connectionIds.length === 0) {
          return resolve()
        }
      })

      this.reader.on('error', reject)
      this.reader.close()
    })
  },

  // { correlationId, ctx, type, followRedirect }
  addToQueue(req) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        ...req,
        date: Date.now(),
        resolve,
        reject
      })
    })
  }
}
