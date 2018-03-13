# kasha - Prerender service for SPA

## Requirements
* [MongoDB](https://www.mongodb.com/)
* [nsq](http://nsq.io/)

## Installation
```sh
npm install kasha -g
```

## Configuration
See [config.sample.js](config.sample.js)

## Running

### Start the server:
```sh
kasha-server --config=/path/to/config.js
```

### Start the worker:
```sh 
kasha-worker --config=/path/to/config.js

# async worker
# requests with 'callbackUrl' parameter will be dispatched to async workers.
kasha-worker --async --config=/path/to/config.js
```

## APIs

### GET /render
Prerenders the page.

#### Query string params:  
`url`: The encoded URL of the webpage to render.  
`deviceType`: `desktop`|`mobile`. Use what type of device to render the page. Defaults to `desktop`.  
`proxy`: Returns the page with `Content-Type: text/html`. Otherwise returns `json`.  
`noWait`: Don't wait the result. It is useful for pre-caching the page.  
`callbackUrl`: Don't wait the result. Once the job is done, `POST` the result to the given url with `json` format.  
`metaOnly`: Only returns meta data without html content.  
`followRedirect`: Follows the redirects if the page return `301`/`302`.  
`ignoreRobotsTxt`: Still crawl the page even if `robots.txt` of the site disallowed.  
`refresh`: Forces to refresh the cache.  

To the boolean parameters, if the param is absent or set to `0`, it means `false`.
If set to `1` or empty value (e.g., `&proxy`, `&proxy=`, `&proxy=1`), it means `true`.   

Example: `http://localhost:3000/render?url=https%3A%2F%2Fdavidwalsh.name%2Ffacebook-meta-tags&deviceType=mobile&callbackUrl=http%3A%2F%2Flocalhost%3A8080%2F&followRedirect`

#### The returned JSON format example:
```json
{
  "url": "https://davidwalsh.name/facebook-meta-tags",
  "deviceType": "desktop",
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
Alias of `/render?url=URL&proxy`.  
Example: `http://localhost:3000/https://www.example.com/`  

Notice: the `hash` of the url won't be sent to server. If you need the `hash` to be sent to the server, use the `/render` API.

### GET /cache?url=URL
Alias of `/render?url=URL&nowait`
