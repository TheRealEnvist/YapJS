'use strict';
const { AuthenticationError } = require('../util/errors');

function decodeYapperValue(stored) {
  if (typeof stored !== 'string' || !stored.trim()) throw new AuthenticationError('Session entry not found.', 'INVALID_SESSION');
  try {
    const bytes = Buffer.from(stored.split('').reverse().join(''), 'base64');
    const encoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const key = 'yapper·v1'; let decoded = '';
    for (let i = 0; i < encoded.length; i++) decoded += String.fromCharCode(encoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    const session = JSON.parse(decoded);
    if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error();
    return session;
  } catch { throw new AuthenticationError('Invalid encoded Yapper session.', 'INVALID_SESSION'); }
}

function normalizeSession(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthenticationError('Invalid session.', 'INVALID_SESSION');
  const refreshToken = input.refresh_token ?? input.refreshToken;
  const accessToken = input.access_token ?? input.accessToken ?? input.token;
  if (typeof refreshToken !== 'string' || !refreshToken || (accessToken !== undefined && typeof accessToken !== 'string')) {
    throw new AuthenticationError('A valid refresh token is required.', 'INVALID_SESSION');
  }
  let expiresAt = Number(input.expires_at ?? input.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    const lifetime = Number(input.expires_in);
    if (Number.isFinite(lifetime) && lifetime > 0) expiresAt = Math.floor(Date.now() / 1000) + lifetime;
    else {
      try { expiresAt = Number(JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')).exp); }
      catch { expiresAt = 0; }
    }
  }
  // A JWT's decoded expiry is only a scheduling hint; the server verifies identity.
  return { access_token: accessToken || '', refresh_token: refreshToken, token_type: 'bearer',
    expires_at: Number.isFinite(expiresAt) ? expiresAt : 0,
    ...(input.expires_in !== undefined ? { expires_in: input.expires_in } : {}),
    ...(input.user ?? previous.user ? { user: input.user ?? previous.user } : {}),
  };
}
module.exports = { decodeYapperValue, normalizeSession };
