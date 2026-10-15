'use strict';
const { EventEmitter, captureRejectionSymbol } = require('node:events');
const Collection = require('../util/Collection');
const { Events } = require('../util/constants');
const { YapperError } = require('../util/errors');
class CollectorError extends YapperError {
  constructor(collected, reason) { super(`Collector ended: ${reason}`, 'COLLECTOR_ENDED'); this.collected = collected; this.reason = reason; }
}
class CollectorHub {
  constructor(client) {
    Object.defineProperty(this, 'client', { value: client }); this.active = new Set(); this.listeners = new Map();
    for (const event of [Events.MessageCreate, Events.MessageReactionAdd, Events.MessageReactionRemove, Events.MessageDelete, Events.ChannelDelete, Events.GuildDelete]) {
      const listener = (...args) => { for (const collector of [...this.active]) collector._handle(event, args); };
      this.listeners.set(event, listener); client.on(event, listener);
    }
  }
  destroy() { for (const collector of [...this.active]) collector.stop('clientDestroy'); for (const [event, listener] of this.listeners) this.client.off(event, listener); this.listeners.clear(); }
}
function timerValue(value, name) { if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 2147483647)) throw new RangeError(`${name} must be a positive integer below 2147483648.`); }
class Collector extends EventEmitter {
  #timeTimer = null; #idleTimer = null; #queue = Promise.resolve();
  constructor(client, options = {}) {
    super({ captureRejections: true });
    const allowed = ['filter', 'time', 'idle', 'max', 'dispose', 'errors'];
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !allowed.includes(key))) throw new TypeError('Invalid collector options.');
    if (options.filter !== undefined && typeof options.filter !== 'function') throw new TypeError('Collector filter must be a function.');
    if (options.errors !== undefined && (!Array.isArray(options.errors) || options.errors.some(reason => typeof reason !== 'string'))) throw new TypeError('Collector errors must be an array of end reasons.');
    timerValue(options.time, 'time'); timerValue(options.idle, 'idle'); timerValue(options.max, 'max');
    Object.defineProperty(this, 'client', { value: client }); this.options = { ...options, time: options.time ?? 60000 }; this.filter = options.filter ?? (() => true);
    this.collected = new Collection(); this.total = 0; this.ended = false; this.endReason = null; this.lastCollectedTimestamp = null;
    this.finished = new Promise(resolve => { this._finish = resolve; });
    if (this.client._isDestroyed) throw new YapperError('Cannot collect on a destroyed client.', 'CLIENT_DESTROYED');
    this.client._collectorHub.active.add(this); this.resetTimer();
  }
  _enqueue(task) { this.#queue = this.#queue.then(async () => { if (!this.ended) await task(); }).catch(() => { this.client._emitError(new YapperError('Collector filter failed.', 'COLLECTOR_FILTER_ERROR')); this.stop('error'); }); }
  async _collect(key, args) {
    const accepted = await this.filter(...args); if (this.ended) return;
    if (!accepted) { this.emit('ignore', ...args); return; }
    this.collected.set(key, args[0]); this.total++; this.lastCollectedTimestamp = Date.now(); this.#resetIdle();
    this.emit('collect', ...args);
    if (this.options.max && this.total >= this.options.max) this.stop('limit');
  }
  #resetIdle() { clearTimeout(this.#idleTimer); if (this.options.idle) { this.#idleTimer = setTimeout(() => this.stop('idle'), this.options.idle); this.#idleTimer.unref?.(); } }
  resetTimer(options = {}) {
    timerValue(options.time, 'time'); timerValue(options.idle, 'idle'); if (this.ended) return this;
    if (options.time !== undefined) this.options.time = options.time; if (options.idle !== undefined) this.options.idle = options.idle;
    clearTimeout(this.#timeTimer); this.#timeTimer = setTimeout(() => this.stop('time'), this.options.time); this.#timeTimer.unref?.(); this.#resetIdle(); return this;
  }
  stop(reason = 'user') {
    if (this.ended) return;
    this.ended = true; this.endReason = reason; clearTimeout(this.#timeTimer); clearTimeout(this.#idleTimer); this.client._collectorHub.active.delete(this);
    const result = { collected: this.collected, reason }; this._finish(result); this.emit('end', this.collected, reason);
  }
  get next() {
    if (this.ended) return Promise.reject(new CollectorError(this.collected, this.endReason));
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.off('collect', collect); this.off('end', end); };
      const collect = (...args) => { cleanup(); resolve(args[0]); }; const end = (_, reason) => { cleanup(); reject(new CollectorError(this.collected, reason)); };
      this.once('collect', collect); this.once('end', end);
    });
  }
  [captureRejectionSymbol]() { this.client._emitError(new YapperError('An async collector listener rejected.', 'COLLECTOR_LISTENER_ERROR')); }
}
class MessageCollector extends Collector {
  constructor(channel, options) { super(channel.client, options); Object.defineProperty(this, 'channel', { value: channel }); }
  _handle(event, args) {
    if (event === Events.ChannelDelete && args[0].id === this.channel.id) this.stop('channelDelete');
    else if (event === Events.GuildDelete && args[0].id === this.channel.guildId) this.stop('guildDelete');
    else if (event === Events.MessageCreate && args[0].channelId === this.channel.id) this._enqueue(() => this._collect(args[0].id, args));
  }
}
class ReactionCollector extends Collector {
  constructor(message, options) { super(message.client, options); Object.defineProperty(this, 'message', { value: message }); this.guildId = message.channel?.guildId; }
  _handle(event, args) {
    if (event === Events.MessageDelete && args[0].id === this.message.id) this.stop('messageDelete');
    else if (event === Events.ChannelDelete && args[0].id === this.message.channelId) this.stop('channelDelete');
    else if (event === Events.GuildDelete && args[0].id === this.guildId) this.stop('guildDelete');
    else if (event === Events.MessageReactionAdd && args[0].message.id === this.message.id) this._enqueue(() => this._collect(`${args[0].emoji.name}:${args[1].id}`, args));
    else if (this.options.dispose && event === Events.MessageReactionRemove && args[0].message.id === this.message.id) this._enqueue(async () => {
      const key = `${args[0].emoji.name}:${args[1].id}`; if (!this.collected.has(key)) return;
      this.collected.delete(key); this.emit('remove', ...args);
    });
  }
}
async function awaitCollected(collector) { const { collected, reason } = await collector.finished; if (collector.options.errors?.includes(reason)) throw new CollectorError(collected, reason); return collected; }
module.exports = { Collector, CollectorHub, CollectorError, MessageCollector, ReactionCollector, awaitCollected };
