'use strict';
const { YapperError, YapperAPIError } = require('./errors');

function wrapError(cause, message, code) {
  const error = new YapperError(message, code);
  if (cause instanceof YapperAPIError) {
    // REST errors contain sanitized metadata, never response bodies or tokens.
    // Keep that metadata when wrapping errors, but never attach an arbitrary
    // application exception, its message, or its stack as a cause.
    const { status, method, route, code: apiCode, retryAfter } = cause;
    error.request = Object.freeze({ status, method, route, code: apiCode, retryAfter });
    error.message += ` ${new YapperAPIError(status, method, route, apiCode).message} (${apiCode}).`;
  }
  return error;
}

module.exports = { wrapError };
