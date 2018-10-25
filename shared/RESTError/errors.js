module.exports = {
  CLIENT_METHOD_NOT_ALLOWED: {
    message: 'Method %s not allowed.',
    httpStatus: 405
  },

  CLIENT_EMPTY_HOST_HEADER: {
    message: 'Host header is empty.',
    httpStatus: 400
  },

  CLIENT_NOT_HTML: {
    message: '%s is not of type HTML.',
    httpStatus: 400
  },

  CLIENT_HOST_CONFIG_NOT_EXIST: {
    message: 'Host config does not exist.',
    httpStatus: 400
  },

  CLIENT_INVALID_PARAM: {
    message: 'Invalid parameter (%s).',
    httpStatus: 400
  },

  CLIENT_NO_SUCH_API: {
    message: 'No such API endpoint exists.',
    httpStatus: 404
  },

  SERVER_URL_REWRITE_ERROR: {
    message: 'URL rewrite error (invalid URL: %s).',
    httpStatus: 500
  },

  SERVER_WORKER_TIMEOUT: {
    message: 'Prerender worker timed out.',
    httpStatus: 500
  },

  SERVER_WORKER_BUSY: {
    message: 'Worker is too busy to handle the request.',
    httpStatus: 500
  },

  SERVER_INTERNAL_ERROR: {
    message: 'Server Internal Error (EVENT_ID: %s-%s).',
    httpStatus: 500
  },

  SERVER_DOC_DELETED: {
    message: 'The document has been deleted.',
    httpStatus: 500
  },

  SERVER_RENDER_ERROR: {
    message: 'Some error occured while rendering the page (%s).',
    httpStatus: 500
  },

  SERVER_CACHE_LOCK_TIMEOUT: {
    message: 'Waiting for cache lock timed out (%s).',
    httpStatus: 500
  },

  SERVER_FETCH_ERROR: {
    message: 'Unable to fetch resource from %s (%s)',
    httpStatus: 500
  }
}
