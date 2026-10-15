'use strict';
const { YapperAPIError } = require('../util/errors');
const { baseUrl } = require('../global');

class REST {
  constructor(client, options = {}) {
    Object.defineProperty(this, 'client', { value: client });
    this.baseUrl = (options.baseUrl || baseUrl).replace(/\/$/, '');
    if (new URL(this.baseUrl).protocol !== 'https:') throw new TypeError('baseUrl must use HTTPS.');
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required.');
    this.timeout = options.requestTimeout ?? 15000;
  }
  async request(route, { method = 'GET', body, headers = {}, auth = true, retry = true, accessToken } = {}) {
    if (!/^\/(?:auth|rest)\/v1\//.test(route)) throw new TypeError('Expected a Yapper auth/rest API route.');
    const token = auth ? accessToken ?? await this.client.auth.getAccessToken() : this.client.apiKey;
    const requestHeaders = { ...headers, apikey: this.client.apiKey, Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    let response;
    try {
      response = await this.fetch(this.baseUrl + route, { method, headers: requestHeaders,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeout), redirect: 'error' });
    } catch { throw new YapperAPIError(0, method, route, 'NETWORK_ERROR'); }
    if (response.status === 401 && auth && retry && method === 'GET' && accessToken === undefined) {
      // A different request may already have rotated the session: reuse that token.
      if (token === this.client.auth.accessToken) await this.client.auth.refresh();
      return this.request(route, { method, body, headers, auth, retry: false });
    }
    const text = response.status === 204 ? '' : await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { if (response.ok) throw new YapperAPIError(response.status, method, route, 'INVALID_JSON'); } }
    if (!response.ok) {
      const code = typeof data?.code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(data.code) ? data.code : undefined;
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new YapperAPIError(response.status, method, route, code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    return data;
  }
  get(route, options) { return this.request(route, { ...options, method: 'GET' }); }
  post(route, body, options) { return this.request(route, { ...options, method: 'POST', body }); }
  patch(route, body, options) { return this.request(route, { ...options, method: 'PATCH', body }); }
  delete(route, options) { return this.request(route, { ...options, method: 'DELETE' }); }
  rpc(name, body = {}) { if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new TypeError('Invalid RPC name'); return this.post(`/rest/v1/rpc/${name}`, body); }
}
module.exports = REST;
