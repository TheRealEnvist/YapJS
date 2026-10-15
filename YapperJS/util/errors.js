'use strict';
class YapperError extends Error {
  constructor(message, code = 'YAPPER_ERROR') { super(message); this.name = this.constructor.name; this.code = code; }
}
class YapperAPIError extends YapperError {
  constructor(status, method, route, code, retryAfter = null) {
    super(`Yapper API request failed (${status || 'network'}): ${method} ${route.split('?')[0]}`, code || 'API_ERROR');
    this.status = status; this.method = method; this.route = route.split('?')[0]; this.retryAfter = retryAfter;
  }
}
class AuthenticationError extends YapperError {
  constructor(message = 'Sign in with a valid session before using the client.', code = 'AUTHENTICATION_REQUIRED') { super(message, code); }
}
class SessionStorageError extends YapperError {
  constructor() { super('Session persistence failed. Resolve storage access before continuing.', 'SESSION_STORAGE_FAILED'); }
}
class MessageBulkDeleteError extends YapperError {
  constructor(deleted, failedId, cause) {
    super('Message deletion stopped after an API failure. Some messages may already be deleted.', 'BULK_DELETE_PARTIAL');
    this.deleted = deleted; this.failedId = failedId; this.cause = cause;
  }
}
module.exports = { MessageBulkDeleteError, YapperError, YapperAPIError, AuthenticationError, SessionStorageError };
