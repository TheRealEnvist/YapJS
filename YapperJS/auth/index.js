'use strict';
const { decodeYapperValue, normalizeSession } = require('./session');
const REST = require('../rest/REST');
// Compatibility helpers; client code should normally use client.auth instead.
function restFor(token, apiKey) { return new REST({ apiKey, auth: { getAccessToken: async () => token } }); }
module.exports = {
  decodeYapperValue, normalizeSession,
  getBotProfile: (token, apiKey) => restFor(token, apiKey).get('/auth/v1/user', { retry: false }),
  getBootstrapData: (token, apiKey) => restFor(token, apiKey).rpc('bootstrap'),
  refreshToken: (_accessToken, refreshToken, apiKey) => restFor(null, apiKey).post('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken }, { auth: false }),
  ...require('./stores'),
};
