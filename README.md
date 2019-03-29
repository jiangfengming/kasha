<p align="center"><img src="static/kasha.svg" width="256" height="256"></p>

# Kasha
Prerender your Single-Page Application.

## Features
* Prerender the Single-Page Application.
* Automatically collect sitemaps from `<meta>`s.
* Generate `robots.txt` with sitemap directives.
* Sync prerendering.
* Async prerendering with callback URL.
* URL rewriting.
* Works as a proxy server.
* Rich APIs.
* Caching.

## Requirements
* [MongoDB](https://www.mongodb.com/)
* [nsq](http://nsq.io/)

## Installation
```sh
yarn global add kasha
```

## Configuration
See [config.sample.js](config.sample.js)

## Running

### Start the server:
```sh
kasha server --config=/path/to/config.js
```

### Start the worker:
```sh 
kasha worker --config=/path/to/config.js

# async worker
# requests with 'callbackURL' parameter will be dispatched to async workers.
kasha worker --async --config=/path/to/config.js
```

## Proxy mode
**DOCS TO BE WRITTEN**

## APIs
Please confirm `apiHost` has been set correctly.

For example, if set `apiHost: '127.0.0.1:3000'`, then only requests from `http(s)://127.0.0.1:3000/*` can access the APIs,
All other domains are served in proxy mode.

### GET /render
Prerenders the page.

#### Query string params:  
`url`: The encoded URL of the webpage to render.

`profile`: The profile to use.

`type`: Set the response type. Defaults to `json`.
  * `html`: Returns html with header `Content-Type: text/html`.
  * `json`: Returns json with header `Content-Type: application/json`.
  * `static`: Returns html with header `Content-Type: text/html`, but stripped the `<script>` tags and `on*` event handlers.

`callbackURL`: Don't wait the result. Once the job is done, `POST` the result to the given URL with `json` format.
If `callbackURL` is set, `type` is ignored.

`metaOnly`: Only returns meta data without html content.

`followRedirect`: Follows the redirects if the page return `301`/`302`.

`refresh`: Forces to refresh the cache.

`noWait`: Don't wait for the response. It is useful for pre-caching the page.

To the boolean parameters, if the param is absent or set to `0`, it means `false`.
If set to `1` or empty value (e.g., `&refresh`, `&refresh=`, `&refresh=1`), it means `true`.   

Example: `http://localhost:3000/render?url=https%3A%2F%2Fdavidwalsh.name%2Ffacebook-meta-tags`

#### The returned JSON format example:
```json
{
  "url": "https://davidwalsh.name/facebook-meta-tags",
  "profile": "",
  "status": 200,
  "redirect": null,
  "meta": {
    "title": "Facebook Open Graph META Tags",
    "description": "Facebook's Open Graph protocol allows for web developers to turn their websites into Facebook \"graph\" objects, allowing a certain level of customization over how information is carried over from a non-Facebook website to Facebook when a page is \"recommended\" and \"liked\".",
    "image": "https://davidwalsh.name/demo/facebook-developers-logo.png",
    "canonicalUrl": "https://davidwalsh.name/facebook-meta-tags",
    "author": "David Walsh",
    "keywords": null
  },
  "openGraph": {
    "og": {
      "locale": {
        "current": "en_US"
      },
      "type": "article",
      "title": "Facebook Open Graph META Tags",
      "description": "Facebook's Open Graph protocol allows for web developers to turn their websites into Facebook \"graph\" objects, allowing a certain level of customization over how information is carried over from a non-Facebook website to Facebook when a page is \"recommended\" and \"liked\".",
      "url": "https://davidwalsh.name/facebook-meta-tags",
      "site_name": "David Walsh Blog",
      "updated_time": "2016-02-23T00:44:54+00:00",
      "image": [
        {
          "url": "https://davidwalsh.name/demo/facebook-developers-logo.png",
          "secure_url": "https://davidwalsh.name/demo/facebook-developers-logo.png"
        },
        {
          "url": "https://davidwalsh.name/demo/david-facebook-share.png",
          "secure_url": "https://davidwalsh.name/demo/david-facebook-share.png"
        }
      ]
    },
    "article": {
      "publisher": "https://www.facebook.com/davidwalshblog",
      "section": "APIs",
      "published_time": "2011-04-25T09:24:28+00:00",
      "modified_time": "2016-02-23T00:44:54+00:00"
    }
  },
  "content": "<!DOCTYPE html><html>...</html>",
  "date": "2018-03-13T09:53:00.921Z"
}
```

### GET /:url
Alias of `/render?url=ENCODED_URL&type=static`.

For example, `http://localhost:3000/https://www.example.com/` is equivalent to `http://localhost:3000/render?url=https%3A%2F%2Fwww.example.com%2F`

Notice: the `hash` of the url won't be sent to server. If you need the `hash` to be sent to the server, use the `/render` API.

### GET /cache?url=URL
Alias of `/render?url=ENCODED_URL&noWait`

### GET /:site/robots.txt
Get `robots.txt` file with sitemaps collected by kasha. e.g.:

```
http://localhost:3000/https://www.example.com/robots.txt
```

It will fetch the `https://www.example.com/robots.txt` file, then append sitemap directives at the end. The result example:

```txt
User-agent: *
Disallow: /cgi-bin/
Disallow: /tmp/
Disallow: /private/

Sitemap: https://www.example.com/sitemaps/index/1.xml
Sitemap: https://www.example.com/sitemaps/index/google/1.xml
Sitemap: https://www.example.com/sitemaps/index/google/news/1.xml
Sitemap: https://www.example.com/sitemaps/index/google/image/1.xml
Sitemap: https://www.example.com/sitemaps/index/google/video/1.xml
```

### GET /:site/sitemaps/:page.xml
Get [sitemap](https://www.sitemaps.org/protocol.html) of page N.

For example:
```
http://localhost:3000/https://www.example.com/sitemaps/1.xml
```

### GET /:site/sitemaps/google/:page.xml
Get [Google sitemap](https://support.google.com/webmasters/answer/183668) of page N.

### GET /:site/sitemaps/google/news/:page.xml
Get [Google news sitemap](https://support.google.com/webmasters/answer/74288) of page N.

### GET /:site/sitemaps/google/image/:page.xml
Get [Google image sitemap](https://support.google.com/webmasters/answer/178636) of page N.

### GET /:site/sitemaps/google/video/:page.xml
Get [Google video sitemap](https://support.google.com/webmasters/answer/80471) of page N.

### GET /:site/sitemaps/index/:page.xml
Get [sitemap index file](https://www.sitemaps.org/protocol.html#index) of page N.

### GET /:site/sitemaps/index/google/:page.xml
Get Google sitemap index file of page N.

### GET /:site/sitemaps/index/google/news/:page.xml
Get Google news sitemap index file of Page N.

### GET /:site/sitemaps/index/google/image/:page.xml
Get Google image sitemap index file of Page N.

### GET /:site/sitemaps/index/google/video/:page.xml
Get Google video sitemap index file of page N.


## Collecting sitemap data
kasha can collect sitemap data from custom Open Graph `<meta>` tags. For example:

```html
<head prefix="og: http://ogp.me/ns# sitemap: https://kasha-io.github.io/kasha/ns/sitemap#">

<!--
canonical url is used as <loc> tag of sitemap xml.
<meta property="og:url" content="..."> can be used also.
-->
<link rel="canonical" href="https://www.example.com/test.html">

<meta property="sitemap:changefreq" content="hourly">
<meta property="sitemap:priority" content="1">
<meta property="sitemap:news:publication:name" content="The Example Times">
<meta property="sitemap:news:publication:language" content="en">
<meta property="sitemap:news:publication_date" content="2018-05-25T09:19:54.000Z">
<meta property="sitemap:news:title" content="Page Title">
<meta property="sitemap:image:loc" content="http://examples.opengraphprotocol.us/media/images/train.jpg">
<meta property="sitemap:image:caption" content="The caption of the image.">
<meta property="sitemap:image:geo_location" content="Limerick, Ireland">
</head>
```

Sitemap data will be collected only if the `origin` of the canonical URL is the same as the current page.

See here for available tags: [sitemap protocol](https://www.sitemaps.org/protocol.html) and [Google sitemap extensions](https://support.google.com/webmasters/answer/183668)

## License
[MIT](LICENSE)

The logo is made from [Prosymbols](https://www.flaticon.com/authors/prosymbols)</a>'s [camera](https://www.flaticon.com/free-icon/camera_204286) icon licensed by [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/).
