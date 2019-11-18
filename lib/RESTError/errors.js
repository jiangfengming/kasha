module.exports = {
  METHOD_NOT_ALLOWED: {
    message: 'Method %s not allowed.',
    httpStatus: 405
  },

  INVALID_HEADER: {
    message: 'Invalid request header (%s).',
    httpStatus: 400
  },

  INVALID_HOST: {
    message: 'Invalid host.',
    httpStatus: 400
  },

  INVALID_PROTOCOL: {
    message: 'Invalid forwarded proto.',
    httpStatus: 400
  },

  HOST_CONFIG_NOT_EXIST: {
    message: 'Host config does not exist.',
    httpStatus: 400
  },

  INVALID_PARAM: {
    message: 'Invalid parameter (%s).',
    httpStatus: 400
  },

  NOT_FOUND: {
    message: 'Not found.',
    httpStatus: 404
  },

  URL_REWRITE_ERROR: {
    message: 'URL rewrite error (invalid URL: %s).',
    httpStatus: 500
  },

  WORKER_TIMEOUT: {
    message: 'Prerender worker timed out.',
    httpStatus: 500
  },

  WORKER_BUSY: {
    message: 'Worker is too busy to handle the request.',
    httpStatus: 500
  },

  INTERNAL_ERROR: {
    message: 'Server Internal Error (LOG_ID: %s).',
    httpStatus: 500
  },

  DOC_DELETED: {
    message: 'The document has been deleted.',
    httpStatus: 500
  },

  RENDER_ERROR: {
    message: 'Some error occured while rendering the page (%s).',
    httpStatus: 500
  },

  CACHE_LOCK_TIMEOUT: {
    message: 'Waiting for cache lock timed out (%s).',
    httpStatus: 500
  },

  FETCH_ERROR: {
    message: 'Unable to fetch resource from %s (%s)',
    httpStatus: 500
  }
}
