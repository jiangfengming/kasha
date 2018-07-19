#!/usr/bin/env node

(async function() {
  const { URL } = require('url')
  const CustomError = require('../shared/CustomError')
  const logger = require('../shared/logger')
  const config = require('../shared/config')

  const mongodb = require('../shared/db')
  const db = await mongodb.connect()

  const collection = db.collection('snapshots')
  /*
  schema:
  site: String
  path: String
  deviceType: String
  status: Number
  redirect: String
  meta: Object
  openGraph: Object
  links: Array
  html: String
  staticHTML: String
  error: String
  times: Number
  createdAt: Date
  expires: Date
  lock: String
  */

  const sitemap = db.collection('sitemaps')
  /*
  schema:
  site: String
  path: String
  lastmod: String
  changefreq: String
  priority: String
  news: Array
  images: Array
  videos: Array
  createdAt: Date
  */

  const Prerenderer = require('puppeteer-prerender')

  const prerendererOpts = {
    timeout: 24 * 1000,
    puppeteerLaunchOptions: {
      handleSIGINT: false
    },
    parseOpenGraphOptions: {
      // these tag has attributes
      alias: {
        'sitemap:video:player_loc': 'sitemap:video:player_loc:_',
        'sitemap:video:restriction': 'sitemap:video:restriction:_',
        'sitemap:video:platform': 'sitemap:video:platform:_',
        'sitemap:video:price': 'sitemap:video:price:_',
        'sitemap:video:uploader': 'sitemap:video:uploader:_'
      },

      arrays: [
        'sitemap:image',
        'sitemap:video',
        'sitemap:video:tag'
      ]
    }
  }

  if (config.loglevel === 'debug') {
    prerendererOpts.debug = true
    prerendererOpts.puppeteerLaunchOptions.headless = false
  }

  const prerenderer = new Prerenderer(prerendererOpts)

  const userAgents = require('./userAgents')

  const uid = require('../shared/uid')
  const callback = require('../shared/callback')

  const argv = require('yargs').argv
  const { Reader } = require('nsqjs')
  const topic = argv.async ? 'kasha-async-queue' : 'kasha-sync-queue'
  const reader = new Reader(topic, 'worker', config.nsq.reader)
  reader.connect()

  const nsqWriter = await require('../shared/nsqWriter').connect()
  const poll = require('../shared/poll')

  let jobCounter = 0

  reader.on('message', async msg => {
    jobCounter++

    const req = msg.json()
    logger.debug(req)

    const {
      replyTo,
      correlationId,
      site,
      path,
      deviceType,
      callbackUrl,
      metaOnly
    } = req

    const url = site + path

    let status, redirect, meta, openGraph, links, html, staticHTML, error, expires
    const now = new Date()
    let createdAt = now

    // lock
    const lock = uid()

    const lockQuery = {
      site,
      path,
      deviceType,
      lock: false,
      $or: [
        { error: { $ne: null } }, // error
        { expires: { $lt: now } } // expired
      ]
    }

    try {
      await collection.updateOne(lockQuery, {
        $set: {
          status,
          redirect,
          meta,
          openGraph,
          links,
          html,
          staticHTML,
          error,
          createdAt,
          expires,
          lock
        },
        $setOnInsert: {
          times: 0
        }
      }, { upsert: true })
    } catch (e) {
      // don't block the queue
      msg.finish()

      if (e.code !== 11000) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      // duplicate key on upsert
      // the document maybe locked by others, or is valid
      try {
        ({ status, redirect, meta, openGraph, links, html, staticHTML, error, createdAt } = await poll(site, path, deviceType))
      } catch (e) {
        return handleResult(e)
      }

      if (error) {
        return handleResult(new CustomError(JSON.parse(error)))
      }

      return handleResult(null, {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        links,
        html: metaOnly ? undefined : html,
        staticHTML: metaOnly ? undefined : staticHTML,
        createdAt
      })
    }

    // render the page
    try {
      ({ status, redirect, meta, openGraph, links, html, staticHTML } = await prerenderer.render(url, {
        userAgent: userAgents[deviceType],
        // always followRedirect when caching pages
        // in case of a request with followRedirect=true waits a cache lock of request with followRedirect=false
        followRedirect: true,
        extraMeta: {
          status: { selector: 'meta[http-equiv="Status" i]', property: 'content' },
          lastModified: { selector: 'meta[http-equiv="Last-Modified" i]', property: 'content' },
          cacheControl: { selector: 'meta[http-equiv="Cache-Control" i]', property: 'content' },
          expires: { selector: 'meta[http-equiv="Expires" i]', property: 'content' }
        }
      }))

      if (meta.status) {
        const s = parseInt(meta.status)
        if (!isNaN(s) && s >= 100 && s < 600) {
          status = s
        }
      }

      if (status >= 500 && status <= 599) {
        error = new CustomError('SERVER_UPSTREAM_ERROR', 'HTTP' + status)
      } else {
        if (meta.cacheControl) {
          const match = meta.cacheControl.match(/s-max-age=(\d+)/) || meta.cacheControl.match(/max-age=(\d+)/)
          if (match) {
            const age = parseInt(match[1])
            if (age >= 0) expires = new Date(now.getTime() + age * 1000)
          }
        }

        if (!expires && meta.expires) {
          const d = new Date(meta.expires)
          if (!isNaN(d.getTime())) {
            expires = d
          }
        }

        if (!expires) {
          expires = new Date(now.getTime() + config.cache * 1000)
        }
      }
    } catch (e) {
      error = new CustomError('SERVER_RENDER_ERROR', e.message)
    }

    if (error) {
      try {
        await collection.updateOne({ site, path, deviceType, lock }, {
          $set: {
            status,
            redirect,
            meta,
            openGraph,
            links,
            html,
            staticHTML,
            error: JSON.stringify(error),
            createdAt,
            expires,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })

        return handleResult(error)
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }
    } else {
      try {
        await collection.updateOne({ site, path, deviceType }, {
          $set: {
            status,
            redirect,
            meta,
            openGraph,
            links,
            html,
            staticHTML,
            error: null,
            createdAt,
            expires,
            lock: false
          },
          $inc: {
            times: 1
          }
        }, { upsert: true })

        // sitemap
        if (meta.canonicalURL) {
          let u
          try {
            u = new URL(meta.canonicalURL)
          } catch (e) {
            // do nothing
          }

          if (u) {
            const u2 = new URL(url)

            if (u.origin === u2.origin) {
              let lastmod, changefreq, priority, news, images, videos

              if (meta.lastModified) {
                const date = new Date(meta.lastModified)
                if (!isNaN(date.getTime())) {
                  lastmod = date.toISOString()
                }
              }

              if (openGraph.sitemap) {
                const sitemap = openGraph.sitemap
                if (sitemap.changefreq) changefreq = sitemap.changefreq
              }

              await sitemap.updateOne({
                site: u.origin,
                path: u.pathname + u.search
              }, {
                $set: {
                  lastmod,
                  changefreq,
                  priority,
                  news,
                  images,
                  videos,
                  createdAt
                }
              }, { upsert: true })
            }
          }
        } else if (status < 200 || status >= 300) {
          const u = new URL(url)
          await sitemap.deleteOne({
            site: u.origin,
            path: u.pathname + u.search
          })
        }
      } catch (e) {
        const { timestamp, eventId } = logger.error(e)
        return handleResult(new CustomError('SERVER_INTERNAL_ERROR', timestamp, eventId))
      }

      return handleResult(null, {
        url,
        deviceType,
        status,
        redirect,
        meta,
        openGraph,
        links,
        html: metaOnly ? undefined : html,
        staticHTML: metaOnly ? undefined : staticHTML,
        createdAt
      })
    }

    function handleResult(error, result) {
      if (callbackUrl) {
        callback(callbackUrl, error, result)
      } else if (replyTo) {
        nsqWriter.publish(replyTo, {
          correlationId,
          error,
          result
        })
      }

      if (!msg.hasResponded) msg.finish()

      logger.debug(`job finished: ${url}`)
      jobCounter--
    }
  })

  // graceful exit
  let stopping = false

  process.once('SIGINT', async() => {
    if (stopping) return

    stopping = true
    logger.info('Closing the worker... Please wait for finishing the in-flight jobs.')
    reader.pause()

    const interval = setInterval(() => {
      if (jobCounter === 0) {
        clearInterval(interval)
        exit()
      }
    }, 1000)

    async function exit() {
      reader.close()
      nsqWriter.close()
      await prerenderer.close()
      await mongodb.close()
    }
  })

  logger.info('Worker started')
}())
