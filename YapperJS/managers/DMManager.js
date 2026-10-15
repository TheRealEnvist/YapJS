'use strict';
const { AuthenticationError, YapperError } = require('../util/errors');
const resolveId = value => require('./index').resolveId(value);
class DMManager {
  #pending = new Map();
  constructor(client) { Object.defineProperty(this, 'client', { value: client }); }
  get cache() { return this.client.channels.cache.filter(channel => channel.isDMBased()); }
  resolve(value) { const channel = this.client.channels.cache.get(resolveId(value)); return channel?.isDMBased() ? channel : null; }
  _find(userId) { return this.cache.find(channel => channel.type !== 'group' && channel.memberIds?.length === 2 && channel.memberIds.includes(userId) && channel.memberIds.includes(this.client.userId)); }
  create(value, { force = false } = {}) {
    const id = resolveId(value);
    if (!this.client.isReady() || !this.client.user) return Promise.reject(new AuthenticationError());
    if (this.#pending.has(id)) return this.#pending.get(id);
    const cached = this._find(id); if (cached && !force) return Promise.resolve(cached);
    const pending = (async () => {
      const channelId = await this.client.rest.rpc('get_or_create_dm', { other: id });
      if (typeof channelId !== 'string' || !channelId) throw new YapperError('DM creation returned no channel ID.', 'INVALID_DM');
      if (this.client._isDestroyed) throw new AuthenticationError();
      const channel = await this.client.channels.fetch(channelId, { force: true });
      if (this.client._isDestroyed) { this.client.channels.cache.delete(channelId); throw new AuthenticationError(); }
      if (!channel || channel.guildId || channel.type === 'voice') throw new YapperError('DM channel is unavailable.', 'INVALID_DM');
      channel._patch({ memberIds: [...new Set([this.client.userId, id])] }); return channel;
    })().finally(() => this.#pending.delete(id));
    this.#pending.set(id, pending); return pending;
  }
  async fetch(value) {
    if (value === undefined) return this.cache;
    const channel = await this.client.channels.fetch(resolveId(value), { force: true });
    if (this.client._isDestroyed) { if (channel) this.client.channels.cache.delete(channel.id); throw new AuthenticationError(); }
    if (!channel || channel.guildId || channel.type === 'voice') return null;
    await this._hydrate(channel); return channel;
  }
  async _hydrate(channel) {
    const params = new URLSearchParams({ select: 'channel_id,user_id', channel_id: `eq.${channel.id}` });
    const rows = await this.client.rest.get(`/rest/v1/channel_members?${params}`);
    if (this.client._isDestroyed) return;
    if (!Array.isArray(rows)) throw new YapperError('Invalid DM member response.', 'INVALID_DM');
    channel._patch({ memberIds: rows.map(row => row.user_id) });
  }
  async send(user, content) { return (await this.create(user)).send(content); }
}
module.exports = DMManager;
