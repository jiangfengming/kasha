module.exports = {
  CLIENT_INVALID_PARAM: {
    message: 'Invalid parameter (%s).',
    httpStatus: 400
  },

  CLIENT_NO_SUCH_API: {
    message: 'No such API endpoint exists.',
    httpStatus: 404
  },

  SERVER_WORKER_TIMEOUT: {
    message: 'Prerender worker timed out.',
    httpStatus: 500
  },

  SERVER_INTERNAL_ERROR: {
    message: 'Server Internal Error (EVENT_ID: %s-%s).',
    httpStatus: 500
  },

  SERVER_RENDER_ERROR: {
    message: 'Some error occured while rendering the page (%s).',
    httpStatus: 500
  },

  SERVER_CACHE_LOCK_TIMEOUT: {
    message: 'Waiting for cache lock timed out (%s).',
    httpStatus: 500
  }
}
