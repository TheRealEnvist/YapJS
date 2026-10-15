'use strict';
const { AuthenticationError, YapperError } = require('../util/errors');
const { Events } = require('../util/constants');
const { objectOptions, text } = require('../util/validation');
const statuses = new Set(['online', 'idle', 'dnd', 'invisible', 'offline']);
function validatePresence(options) {
  objectOptions(options, ['status', 'activity'], 'presence');
  if (options.status !== undefined && !statuses.has(options.status)) throw new TypeError('Status must be online, idle, dnd, invisible, or offline.');
  const result = {};
  if (options.status !== undefined) result.status = options.status;
  if (options.activity !== undefined) {
    if (options.activity === null) result.activity = null;
    else {
      const activity = typeof options.activity === 'string' ? { name: options.activity } : options.activity;
      objectOptions(activity, ['name', 'since'], 'activity');
      const since = activity.since === undefined ? Date.now() : activity.since;
      if (!Number.isSafeInteger(since) || since < 0) throw new TypeError('Activity since must be a nonnegative timestamp in milliseconds.');
      result.activity = { name: text(activity.name, 'Activity name'), since };
    }
  }
  if (!Object.keys(result).length) throw new TypeError('Supply a status or activity.');
  return result;
}
class PresenceManager {
  #status = 'online'; #activity = null; #timer = null; #queue = Promise.resolve(); #generation = 0; #enabled = false;
  constructor(client, interval = 45000) {
    Object.defineProperty(this, 'client', { value: client });
    if (!Number.isInteger(interval) || interval < 1000 || interval > 2147483647) throw new RangeError('presenceInterval must be between 1000 and 2147483647 milliseconds.');
    this.interval = interval;
  }
  get status() { return this.#status; }
  get activity() { return this.#activity ? { ...this.#activity } : null; }
  get enabled() { return this.#enabled; }
  #enqueue(task) {
    const generation = this.#generation;
    const promise = this.#queue.catch(() => {}).then(async () => {
      if (!this.client.isReady() || !this.client.user) throw new AuthenticationError();
      if (generation !== this.#generation) throw new YapperError('Presence operation was cancelled.', 'PRESENCE_CANCELLED');
      return task(generation);
    });
    this.#queue = promise; return promise;
  }
  async #send(status, activity, generation) {
    await this.client.rest.rpc('heartbeat', { st: status === 'offline' ? 'off' : status, act: status === 'offline' ? null : activity });
    if (generation !== this.#generation || !this.client.isReady()) throw new YapperError('Presence operation was cancelled.', 'PRESENCE_CANCELLED');
  }
  setPresence(options) {
    const parsed = validatePresence(options);
    return this.#enqueue(async generation => {
      const status = parsed.status ?? this.#status;
      const activity = parsed.activity === undefined ? this.#activity : parsed.activity;
      await this.#send(status, activity, generation);
      const previous = this.toJSON(); this.#status = status; this.#activity = activity;
      this.#enabled = status !== 'offline'; this.#schedule();
      this.client.emit(Events.PresenceUpdate, previous, this.toJSON());
      return this;
    });
  }
  setStatus(status) { return this.setPresence({ status }); }
  setActivity(activity) { return this.setPresence({ activity }); }
  heartbeat() {
    return this.#enqueue(async generation => { await this.#send(this.#status, this.#activity, generation); return this; });
  }
  #schedule() {
    clearTimeout(this.#timer); this.#timer = null;
    if (!this.#enabled) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.heartbeat().catch(error => this.client._emitError(error)).finally(() => { if (this.#enabled && this.client.isReady()) this.#schedule(); });
    }, this.interval);
    this.#timer.unref?.();
  }
  destroy() { this.#generation++; this.#enabled = false; clearTimeout(this.#timer); this.#timer = null; }
  toJSON() { return { status: this.status, activity: this.activity }; }
}
module.exports = { PresenceManager, validatePresence };
