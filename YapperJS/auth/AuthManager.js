'use strict';
const { normalizeSession, decodeYapperValue } = require('./session');
const { MemorySessionStore } = require('./stores');
const { AuthenticationError, SessionStorageError } = require('../util/errors');
const { Events } = require('../util/constants');

class AuthManager {
  #session = null; #pendingSave = false; #refreshPromise = null; #savePromise = null; #timer = null; #epoch = 0; #stopped = false;
  constructor(client, options = {}) {
    Object.defineProperty(this, 'client', { value: client });
    this.store = options.sessionStore || new MemorySessionStore();
    if (typeof this.store.load !== 'function' || typeof this.store.save !== 'function') throw new TypeError('sessionStore must implement async load() and save(session).');
    this.autoRefresh = options.autoRefresh !== false;
    this.margin = options.refreshMargin ?? 60000;
    if (!Number.isFinite(this.margin) || this.margin < 0) throw new TypeError('refreshMargin must be nonnegative milliseconds.');
  }
  get accessToken() { return this.#session?.access_token ?? null; }
  get refreshToken() { return this.#session?.refresh_token ?? null; }
  get expiresAt() { return this.#session?.expires_at ?? null; }
  async login(input) {
    this.#stopped = false; const epoch = ++this.#epoch;
    let session = input;
    if (session === undefined) { try { session = await this.store.load(); } catch { throw new SessionStorageError(); } }
    if (typeof session === 'string') session = session.trim().startsWith('{') ? this.#parseJSON(session) : decodeYapperValue(session);
    this.#session = normalizeSession(session); this.#pendingSave = false;
    if (!this.#session.access_token || this.#session.expires_at * 1000 <= Date.now() + this.margin) await this.refresh();
    const user = await this.client.rest.get('/auth/v1/user');
    this.#assertCurrent(epoch);
    if (!user?.id) throw new AuthenticationError('The API did not return an authenticated user.', 'INVALID_USER');
    this.#session = { ...this.#session, user }; this.#pendingSave = true;
    await this.#persist(); this.#assertCurrent(epoch); this.#schedule();
    return user;
  }
  #parseJSON(value) { try { return JSON.parse(value); } catch { throw new AuthenticationError('Invalid session JSON.', 'INVALID_SESSION'); } }
  #assertCurrent(epoch) { if (this.#stopped || epoch !== this.#epoch) throw new AuthenticationError('Authentication was cancelled.', 'AUTH_CANCELLED'); }
  async #persist() {
    if (!this.#pendingSave) return;
    if (this.#savePromise) return this.#savePromise;
    this.#savePromise = Promise.resolve().then(async () => {
      try { await this.store.save(structuredClone(this.#session)); this.#pendingSave = false; }
      catch { throw new SessionStorageError(); }
    }).finally(() => { this.#savePromise = null; });
    return this.#savePromise;
  }
  async getAccessToken() {
    if (this.#stopped || !this.#session) throw new AuthenticationError();
    await this.#persist();
    if (!this.#session.access_token || this.#session.expires_at * 1000 <= Date.now() + this.margin) await this.refresh();
    if (this.#stopped || !this.#session) throw new AuthenticationError();
    return this.#session.access_token;
  }
  async getSession() { await this.getAccessToken(); return structuredClone(this.#session); }
  refresh() {
    if (this.#refreshPromise) return this.#refreshPromise;
    if (this.#stopped || !this.#session?.refresh_token) return Promise.reject(new AuthenticationError());
    this.#refreshPromise = (async () => {
      const epoch = this.#epoch;
      try {
        if (this.#stopped || !this.#session?.refresh_token) throw new AuthenticationError();
        await this.#persist();
        const data = await this.client.rest.post('/auth/v1/token?grant_type=refresh_token',
          { refresh_token: this.#session.refresh_token }, { auth: false, retry: false });
        this.#assertCurrent(epoch);
        if (!data?.access_token || !data?.refresh_token) throw new AuthenticationError('Refresh returned an incomplete session.', 'INVALID_SESSION');
        const replacement = normalizeSession(data, this.#session);
        if (this.#session.user?.id && replacement.user?.id && this.#session.user.id !== replacement.user.id) throw new AuthenticationError('Refresh returned a different account.', 'ACCOUNT_MISMATCH');
        this.#session = replacement; this.#pendingSave = true;
        await this.#persist(); this.#assertCurrent(epoch);
        this.#schedule();
        const metadata = { expiresAt: this.expiresAt };
        this.client.emit(Events.TokenRefresh, metadata); this.client.emit(Events.SessionUpdate, metadata);
        if (this.client.isReady()) this.client.gateway?.reauthenticate();
        return structuredClone(this.#session);
      } finally { this.#refreshPromise = null; }
    })();
    return this.#refreshPromise;
  }
  #schedule(delay) {
    clearTimeout(this.#timer); this.#timer = null;
    if (!this.autoRefresh || this.#stopped || !this.#session) return;
    const wait = delay ?? Math.max(1000, this.#session.expires_at * 1000 - Date.now() - this.margin);
    this.#timer = setTimeout(() => {
      this.refresh().catch(error => {
        if (this.#stopped) return;
        this.client._emitError(error);
        if (![400, 401, 403].includes(error.status)) this.#schedule(30000);
      });
    }, Math.min(wait, 2147483647));
    this.#timer.unref?.();
  }
  destroy() { this.#stopped = true; this.#epoch++; clearTimeout(this.#timer); this.#timer = null; this.#session = null; this.#pendingSave = false; }
  toJSON() { return { authenticated: !!this.#session, expiresAt: this.expiresAt }; }
}
module.exports = AuthManager;
