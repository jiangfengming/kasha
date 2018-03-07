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
Params:  
`url`: The encoded URL of the webpage to render.  
`deviceType`: `desktop`|`mobile`. Use what type of device to render the page.  
`proxy`: Returns the page as `test/html`. Otherwise will return `json`.  
`noWait`: Don't wait the response.  
`metaOnly`: Only returns meta data, such as `status`, `title`, without `content`.  
`followRedirect`: Follows the redirects if the page return `301`/`302`.  
`ignoreRobotsTxt`: Still crawl the page even if `robots.txt` of the site disallowed.  
`refresh`: Force to refresh the cache.


### GET /proxy/:url
Alias of `/render?url=URL&proxy`.  
Notes: In browsers, `hash` of the url won't be sent to server.

### GET /cache?url=URL
Alias of `/render?url=URL&nowait`
