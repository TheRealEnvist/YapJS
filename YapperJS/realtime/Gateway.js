'use strict';
const { Events } = require('../util/constants');
const { gatewayUrl } = require('../global');
const { YapperError } = require('../util/errors');

class Gateway {
  #socket = null; #running = false; #authenticated = false; #reconnectTimer = null; #authTimer = null; #attempt = 0; #subscribed = new Set(); #extraTopics = new Set(); #resolve = null; #reject = null;
  constructor(client, options = {}) {
    Object.defineProperty(this, 'client', { value: client });
    this.url = options.gatewayUrl || gatewayUrl;
    if (new URL(this.url).protocol !== 'wss:') throw new TypeError('gatewayUrl must use WSS.');
    this.WebSocket = options.WebSocket || globalThis.WebSocket;
    this.authTimeout = options.gatewayTimeout ?? 15000;
  }
  get connected() { return this.#authenticated; }
  start() {
    if (typeof this.WebSocket !== 'function') throw new TypeError('Realtime needs Node.js 22+ or a supplied WebSocket implementation.');
    if (this.#running) throw new YapperError('Gateway is already running.', 'GATEWAY_RUNNING');
    this.#running = true;
    return new Promise((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; this.#connect(); });
  }
  #connect() {
    if (!this.#running) return;
    let socket;
    try { socket = new this.WebSocket(this.url); } catch { this.#fail(new YapperError('Cannot open the gateway connection.', 'GATEWAY_CONNECTION_FAILED')); return; }
    this.#socket = socket; this.#authenticated = false; this.#subscribed.clear();
    this.#authTimer = setTimeout(() => { if (this.#socket === socket) { this.#fail(new YapperError('Gateway authentication timed out.', 'GATEWAY_TIMEOUT')); socket.close(); } }, this.authTimeout);
    socket.addEventListener('open', () => {
      this.client.auth.getAccessToken().then(token => {
        if (this.#socket === socket && this.#running && socket.readyState === 1) socket.send(JSON.stringify({ type: 'auth', token }));
      }).catch(error => { this.#fail(error); socket.close(); });
    });
    socket.addEventListener('message', event => {
      if (this.#socket !== socket || !this.#running) return;
      let data; try { data = JSON.parse(String(event.data)); } catch { return; }
      if (data.type === 'auth') {
        if (!data.ok) { this.#fail(new YapperError('Gateway rejected the session.', 'GATEWAY_AUTH_FAILED')); socket.close(); return; }
        clearTimeout(this.#authTimer); this.#authTimer = null;
        this.#authenticated = true; const reconnected = this.#attempt > 0; this.#attempt = 0;
        this.syncTopics(); this.#resolve?.(); this.#resolve = null; this.#reject = null;
        this.client.emit(Events.GatewayReady); if (reconnected) this.client.emit(Events.GatewayReconnect);
        return;
      }
      if (!this.#authenticated) return;
      if (data.type === 'subscribed') { for (const topic of data.ok ?? []) this.#subscribed.add(topic); return; }
      if (data.type === 'event' && typeof data.event === 'string' && data.payload && typeof data.payload === 'object') {
        try { this.client._dispatch(data.event, data.payload); } catch { this.client._emitError(new YapperError('Invalid gateway event.', 'GATEWAY_EVENT_ERROR')); }
      }
    });
    socket.addEventListener('close', event => {
      if (this.#socket !== socket) return;
      this.#socket = null; this.#authenticated = false; this.#subscribed.clear(); clearTimeout(this.#authTimer);
      if (!this.#running) return;
      if (this.#reject) { this.#fail(new YapperError('Gateway closed before authentication.', 'GATEWAY_CONNECTION_FAILED')); return; }
      this.client.emit(Events.GatewayDisconnect, { code: event.code }); this.#scheduleReconnect();
    });
    socket.addEventListener('error', () => { if (this.#socket === socket) socket.close(); });
  }
  #fail(error) {
    clearTimeout(this.#authTimer); this.#authTimer = null;
    if (this.#reject) { const reject = this.#reject; this.#reject = null; this.#resolve = null; this.#running = false; reject(error); }
    else this.client._emitError(error);
  }
  #scheduleReconnect() {
    clearTimeout(this.#reconnectTimer);
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.#attempt++, 5));
    this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
  }
  topics() {
    const topics = new Set(['all', `user:${this.client.user.id}`, ...this.#extraTopics]);
    for (const guild of this.client.guilds.cache.values()) topics.add(`server:${guild.id}`);
    for (const channel of this.client.channels.cache.values()) if (channel.guildId && channel.type === 'text') topics.add(`chan:${channel.id}`);
    return topics;
  }
  syncTopics() {
    if (!this.#authenticated || this.#socket?.readyState !== 1) return;
    const wanted = this.topics();
    const add = [...wanted].filter(topic => !this.#subscribed.has(topic));
    const remove = [...this.#subscribed].filter(topic => !wanted.has(topic));
    if (add.length) this.#socket.send(JSON.stringify({ type: 'subscribe', topics: add }));
    if (remove.length) { this.#socket.send(JSON.stringify({ type: 'unsubscribe', topics: remove })); for (const topic of remove) this.#subscribed.delete(topic); }
  }
  sendTyping(channelId, recipients) {
    if (!this.#authenticated || this.#socket?.readyState !== 1) return false;
    if (recipients !== undefined) {
      if (!Array.isArray(recipients) || !recipients.length || recipients.some(id => typeof id !== 'string')) return false;
    } else if (!this.#subscribed.has(`chan:${channelId}`)) return false;
    this.#socket.send(JSON.stringify({ type: 'typing', channel: channelId, ...(recipients ? { to: recipients } : {}) })); return true;
  }
  watch(channel) { const { resolveId } = require('../managers'); this.#extraTopics.add(`chan:${resolveId(channel)}`); this.syncTopics(); }
  unwatch(channel) { const { resolveId } = require('../managers'); this.#extraTopics.delete(`chan:${resolveId(channel)}`); this.syncTopics(); }
  reauthenticate() {
    if (!this.#running) return;
    clearTimeout(this.#reconnectTimer); clearTimeout(this.#authTimer);
    const socket = this.#socket; this.#socket = null; this.#authenticated = false;
    socket?.close(); this.#connect();
  }
  destroy() {
    this.#running = false; clearTimeout(this.#reconnectTimer); clearTimeout(this.#authTimer);
    const socket = this.#socket; this.#socket = null; this.#authenticated = false; socket?.close();
    const reject = this.#reject; this.#reject = null; this.#resolve = null;
    reject?.(new YapperError('Gateway connection was cancelled.', 'GATEWAY_CANCELLED'));
  }
  toJSON() { return { connected: this.connected }; }
}
module.exports = Gateway;
