'use strict';
const { normalizeSession, decodeYapperValue } = require('./session');
const { MemorySessionStore } = require('./stores');
const { AuthenticationError, SessionStorageError } = require('../util/errors');
const { Events } = require('../util/constants');

class AuthManager {
  #session = null; #pendingSave = false; #pendingRotation = false; #refreshPromise = null; #savePromise = null;
  #timer = null; #epoch = 0; #stopped = false; #invalidated = false; #attempt = 0; #refreshAt = 0;
  constructor(client, options = {}) {
    Object.defineProperty(this, 'client', { value: client });
    this.store = options.sessionStore || new MemorySessionStore();
    if (typeof this.store.load !== 'function' || typeof this.store.save !== 'function') throw new TypeError('sessionStore must implement async load() and save(session).');
    this.autoRefresh = options.autoRefresh !== false;
    this.margin = options.refreshMargin ?? 60000;
    this.retryDelay = options.refreshRetryDelay ?? 5000; this.retryMaxDelay = options.refreshRetryMaxDelay ?? 300000;
    if (!Number.isFinite(this.margin) || this.margin < 0) throw new TypeError('refreshMargin must be nonnegative milliseconds.');
    if (!Number.isSafeInteger(this.retryDelay) || this.retryDelay < 1000 || !Number.isSafeInteger(this.retryMaxDelay) || this.retryMaxDelay < this.retryDelay) throw new RangeError('Refresh retry delays must be integer milliseconds, at least 1000, with max >= initial.');
  }
  get accessToken() { return this.#session?.access_token ?? null; }
  get refreshToken() { return this.#session?.refresh_token ?? null; }
  get expiresAt() { return this.#session?.expires_at ?? null; }
  get requiresLogin() { return this.#invalidated; }
  #replace(session) {
    this.#session = session;
    const remaining = session.expires_at * 1000 - Date.now();
    // Short-lived sessions should not trigger an exchange every second just
    // because their entire lifetime is shorter than the configured margin.
    this.#refreshAt = session.expires_at * 1000 - Math.min(this.margin, Math.max(1000, remaining / 2));
  }
  async login(input) {
    clearTimeout(this.#timer); this.#timer = null;
    this.#stopped = false; this.#invalidated = false; this.#attempt = 0; this.#pendingRotation = false;
    const epoch = ++this.#epoch;
    let session = input;
    if (session === undefined) { try { session = await this.store.load(); } catch { throw new SessionStorageError(); } }
    this.#assertCurrent(epoch);
    if (typeof session === 'string') session = session.trim().startsWith('{') ? this.#parseJSON(session) : decodeYapperValue(session);
    this.#replace(normalizeSession(session)); this.#pendingSave = false;
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
    const epoch = this.#epoch, session = structuredClone(this.#session);
    this.#savePromise = Promise.resolve().then(async () => {
      this.#assertCurrent(epoch);
      try { await this.store.save(session); }
      catch { throw new SessionStorageError(); }
      this.#assertCurrent(epoch); this.#pendingSave = false;
    }).finally(() => { this.#savePromise = null; });
    return this.#savePromise;
  }
  async getAccessToken() {
    if (this.#invalidated) throw new AuthenticationError('The session was revoked or rejected. Log in with a new session.', 'SESSION_INVALIDATED');
    if (this.#stopped || !this.#session) throw new AuthenticationError();
    if (this.#refreshPromise) await this.#refreshPromise;
    await this.#persist(); this.#completeRotation();
    if (!this.#session?.access_token || Date.now() >= this.#refreshAt) await this.refresh();
    if (this.#stopped || !this.#session || this.#invalidated) throw new AuthenticationError();
    return this.#session.access_token;
  }
  async getSession() { await this.getAccessToken(); return structuredClone(this.#session); }
  refresh() {
    if (this.#refreshPromise) return this.#refreshPromise;
    if (this.#invalidated) return Promise.reject(new AuthenticationError('Log in with a new session.', 'SESSION_INVALIDATED'));
    if (this.#stopped || !this.#session?.refresh_token) return Promise.reject(new AuthenticationError());
    this.#refreshPromise = (async () => {
      const epoch = this.#epoch;
      try {
        await this.#persist(); this.#assertCurrent(epoch);
        if (this.#pendingRotation) { this.#completeRotation(); return structuredClone(this.#session); }
        const data = await this.client.rest.post('/auth/v1/token?grant_type=refresh_token',
          { refresh_token: this.#session.refresh_token }, { auth: false, retry: false });
        this.#assertCurrent(epoch);
        if (!data?.access_token || !data?.refresh_token) throw new AuthenticationError('Refresh returned an incomplete session.', 'INVALID_SESSION');
        const replacement = normalizeSession(data, this.#session);
        if (this.#session.user?.id && replacement.user?.id && this.#session.user.id !== replacement.user.id) throw new AuthenticationError('Refresh returned a different account.', 'ACCOUNT_MISMATCH');
        this.#replace(replacement); this.#pendingSave = true; this.#pendingRotation = true;
        await this.#persist(); this.#assertCurrent(epoch); this.#completeRotation();
        return structuredClone(this.#session);
      } catch (error) {
        if (!this.#stopped && epoch === this.#epoch) {
          if ([400, 401, 403].includes(error.status) || error.code === 'ACCOUNT_MISMATCH') {
            this.#invalidated = true; clearTimeout(this.#timer); this.#timer = null;
            this.client._invalidateSession({ code: error.code, status: error.status ?? null });
          } else this.#retry(error);
        }
        throw error;
      } finally { this.#refreshPromise = null; }
    })();
    return this.#refreshPromise;
  }
  #completeRotation() {
    if (!this.#pendingRotation || this.#pendingSave || this.#stopped) return;
    this.#pendingRotation = false; this.#attempt = 0; this.#schedule();
    const metadata = { expiresAt: this.expiresAt };
    this.client.emit(Events.TokenRefresh, metadata); this.client.emit(Events.SessionUpdate, metadata);
    if (this.client.isReady()) this.client.gateway?.reauthenticate();
  }
  #retry(error) {
    if (!this.autoRefresh) return;
    this.#attempt++;
    const backoff = Math.min(this.retryMaxDelay, this.retryDelay * 2 ** Math.min(this.#attempt - 1, 16));
    const delay = Math.max(backoff, (error.retryAfter ?? 0) * 1000);
    this.#schedule(delay);
    this.client.emit(Events.RefreshRetry, { attempt: this.#attempt, retryIn: delay, code: error.code ?? 'REFRESH_FAILED', status: error.status ?? null });
  }
  #schedule(delay) {
    clearTimeout(this.#timer); this.#timer = null;
    if (!this.autoRefresh || this.#stopped || this.#invalidated || !this.#session) return;
    const wait = delay ?? Math.max(1000, this.#refreshAt - Date.now());
    this.#timer = setTimeout(() => {
      if (!this.#pendingRotation && this.#attempt === 0 && Date.now() < this.#refreshAt) { this.#schedule(); return; }
      this.refresh().catch(error => { if (!this.#stopped) this.client._emitError(error); });
    }, Math.min(wait, 2147483647));
    this.#timer.unref?.();
  }
  destroy() {
    this.#stopped = true; this.#epoch++; clearTimeout(this.#timer); this.#timer = null;
    this.#session = null; this.#pendingSave = false; this.#pendingRotation = false; this.#attempt = 0;
  }
  toJSON() { return { authenticated: !!this.#session && !this.#invalidated, expiresAt: this.expiresAt, requiresLogin: this.requiresLogin }; }
}
module.exports = AuthManager;
