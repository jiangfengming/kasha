async function proxy(ctx) {
  const url = new URL(ctx.siteConf.protocol + ctx.host + ctx.url)
  const ext = path.extname(url.pathname)
  const isHTML = ['.html', '.htm'].includes(ext)
  const isAsset = isHTML ? false : ctx.siteConf.assetExtensions.includes(ext)
  const noPrerender = ['', '1'].includes(ctx.query._no_prerender)
  const isRobotsTxt = url.pathname === '/robots.txt' && !noPrerender
  const upstream = !isRobotsTxt && (isAsset || noPrerender) ? 'origin' : 'kasha'

  let upstreamURL, headers
  if (upstream === 'origin') {
    if (!isHTML && !isAsset) {
      const pathname = fileMap(url.pathname, ctx.siteConf.virtualPathMapping)
      if (!pathname) throw new RESTError('CLIENT_PROXY_VIRTUAL_PATH_NO_MAPPING', url.pathname)

      url.pathname = pathname
    }

    upstreamURL = new URL(ctx.siteConf.origin)
    upstreamURL.pathname = url.pathname
    headers = ctx.siteConf.originHeaders
  } else {
    upstreamURL = new URL(ctx.siteConf.kasha)
    upstreamURL.pathname = '/' + url.origin + url.pathname
    headers = ctx.siteConf.kashaHeaders
  }

  if (!ctx.siteConf.removeQueryString) {
    upstreamURL.search = url.search
  }

  try {
    const res = await request(upstreamURL, headers)
    ctx.status = res.statusCode
    delete res.headers['content-disposition']
    delete res.headers.connection
    ctx.set(res.headers)
    ctx.body = res
  } catch (e) {
    throw new RESTError('SERVER_PROXY_FETCHING_ERROR', upstream, e.message)
  }
}

function fileMap(pathname, maps) {
  const router = new URLRouter()
  for (const [from, to] of maps) {
    router.get(from, to)
  }

  const matched = router.find('GET', pathname)
  return matched ? matched.handler : null
}
