'use strict';
const { randomUUID } = require('node:crypto');
const Collection = require('../util/Collection');
const { User, ClientUser, Channel, Guild, Message } = require('../structures');
const { AuthenticationError, MessageBulkDeleteError } = require('../util/errors');
function resolveId(value) { const id = typeof value === 'string' ? value : value?.id; if (typeof id !== 'string' || !id || id.length > 200 || /[\u0000-\u001f]/.test(id)) throw new TypeError('Expected an ID or an object with an ID.'); return id; }
const eq = value => `eq.${value}`;
function query(table, params) { return `/rest/v1/${table}?${new URLSearchParams(params)}`; }

class BaseManager {
  constructor(client, structure, table) { Object.defineProperty(this, 'client', { value: client }); this.cache = new Collection(); this.structure = structure; this.table = table; }
  resolve(value) { return value instanceof this.structure ? value : this.cache.get(resolveId(value)) ?? null; }
  _add(data) { if (!data?.id) throw new TypeError('API entity is missing an ID.'); const existing = this.cache.get(data.id); if (existing) { existing._patch(data); return existing; } const entity = new this.structure(this.client, data); this.cache.set(entity.id, entity); return entity; }
  async fetch(value, { force = false } = {}) {
    if (value === undefined) { if (!force) return this.cache; const rows = await this.client.rest.get(query(this.table, { select: '*' })); for (const row of rows ?? []) this._add(row); return this.cache; }
    const id = resolveId(value); if (!force && this.cache.has(id)) return this.cache.get(id);
    const rows = await this.client.rest.get(query(this.table, { select: '*', id: eq(id), limit: '1' })); return rows?.[0] ? this._add(rows[0]) : null;
  }
}
class UserManager extends BaseManager { constructor(client) { super(client, User, 'profiles'); } createDM(user, options) { return this.client.dms.create(user, options); } send(user, content) { return this.client.dms.send(user, content); } }
class ChannelManager extends BaseManager {
  constructor(client) { super(client, Channel, 'channels'); }
  async fetchGuild(guild) { const id = resolveId(guild); const rows = await this.client.rest.get(query('channels', { select: '*', server_id: eq(id) })); return new Collection((rows ?? []).map(row => { const channel = this._add(row); return [channel.id, channel]; })); }
}
class GuildManager extends BaseManager { constructor(client) { super(client, Guild, 'servers'); } }
function messageOptions(input) {
  const options = typeof input === 'string' ? { content: input } : input;
  if (!options || typeof options.content !== 'string' || !options.content.trim()) throw new TypeError('Message content must be a nonempty string.');
  const unsupported = Object.keys(options).filter(key => !['content', 'replyTo'].includes(key));
  if (unsupported.length) throw new TypeError(`Unsupported message option: ${unsupported.join(', ')}`);
  return { content: options.content.trim(), ...(options.replyTo ? { reply_to_id: resolveId(options.replyTo) } : {}) };
}
class MessageManager extends BaseManager {
  constructor(channel) { super(channel.client, Message, 'messages'); Object.defineProperty(this, 'channel', { value: channel }); }
  _add(data) { if (data.channel_id && data.channel_id !== this.channel.id) throw new TypeError('Message belongs to a different channel.'); let message; const partial = this.client._partialMessages.get(data.id); if (!this.cache.has(data.id) && partial) { message = partial._patch({ ...data, channel_id: this.channel.id }); this.cache.set(data.id, message); this.client._partialMessages.delete(data.id); } else message = super._add({ ...data, channel_id: this.channel.id }); const maximum = this.client.options.messageCacheMaxSize; while (this.cache.size > maximum) this.cache.delete(this.cache.keys().next().value); return message; }
  async fetch(value = {}, options = {}) {
    const filter = { select: '*', channel_id: eq(this.channel.id) };
    if (typeof value === 'string' || value?.id) {
      const id = resolveId(value); if (!options.force && this.cache.has(id)) return this.cache.get(id);
      const rows = await this.client.rest.get(query('messages', { ...filter, id: eq(id), limit: '1' })); return rows?.[0] ? this._add(rows[0]) : null;
    }
    const limit = value.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Message fetch limit must be between 1 and 100.');
    if (value.before) { const date = new Date(value.before); if (!Number.isFinite(date.getTime())) throw new TypeError('before must be a date or ISO timestamp.'); filter.created_at = `lt.${date.toISOString()}`; }
    const rows = await this.client.rest.get(query('messages', { ...filter, order: 'created_at.desc,id.desc', limit: String(limit) }));
    return new Collection((rows ?? []).map(row => { const message = this._add(row); return [message.id, message]; }));
  }
  async create(input) {
    if (!this.client.user) throw new AuthenticationError();
    const row = { ...messageOptions(input), id: randomUUID(), channel_id: this.channel.id, author_id: this.client.user.id };
    const rows = await this.client.rest.post('/rest/v1/messages?select=*', row, { headers: { Prefer: 'return=representation' } });
    if (!rows?.[0]) throw new Error('Message creation returned no record.');
    return this._add(rows[0]);
  }
  async edit(value, input) {
    const id = resolveId(value); const options = messageOptions(input);
    if (options.reply_to_id) throw new TypeError('Editing a reply target is not supported.');
    const rows = await this.client.rest.patch(query('messages', { id: eq(id), channel_id: eq(this.channel.id), select: '*' }), { content: options.content }, { headers: { Prefer: 'return=representation' } });
    if (!rows?.[0]) throw new Error('Message was not edited.'); return this._add(rows[0]);
  }
  async bulkDelete(input) {
    if (!this.client.isReady()) throw new AuthenticationError();
    let messages;
    if (typeof input === 'number') {
      if (!Number.isInteger(input) || input < 1 || input > 100) throw new RangeError('Delete between 1 and 100 recent messages.');
      messages = [...(await this.fetch({ limit: input })).values()];
    } else {
      const values = input instanceof Map ? [...input.values()] : input;
      if (!Array.isArray(values) || values.length < 1 || values.length > 100) throw new RangeError('Supply between 1 and 100 messages.');
      // Validate the entire request before any deletion.
      messages = values.map(value => { if (value?.channelId && value.channelId !== this.channel.id) throw new TypeError('Message belongs to another channel.'); const id = resolveId(value); return this.cache.get(id) ?? new Message(this.client, { id, channel_id: this.channel.id }); });
    }
    const deleted = new Collection();
    for (const message of messages) {
      if (deleted.has(message.id)) continue;
      try { await this.delete(message.id); deleted.set(message.id, message); }
      catch (error) { throw new MessageBulkDeleteError(deleted, message.id, error); }
    }
    return deleted;
  }
  async delete(value) {
    const id = resolveId(value); const rows = await this.client.rest.delete(query('messages', { id: eq(id), channel_id: eq(this.channel.id), select: 'id' }), { headers: { Prefer: 'return=representation' } });
    if (!rows?.length) throw new Error('Message was not deleted.');
    this.client._removeMessage(this.cache.get(id) ?? new Message(this.client, { id, channel_id: this.channel.id }));
  }
}
const { GuildChannelManager } = require('./customization')({ UserManager, ChannelManager, GuildManager, BaseManager, resolveId, query, Collection, User, ClientUser, Channel });
module.exports = { DMManager: require('./DMManager'), UserManager, ChannelManager, GuildManager, GuildChannelManager, GuildMemberManager: require('./GuildMemberManager'), MessageManager, resolveId };
