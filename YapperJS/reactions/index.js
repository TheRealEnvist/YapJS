'use strict';
const Collection = require('../util/Collection');
const { AuthenticationError, YapperError } = require('../util/errors');
const { text } = require('../util/validation');
const emojiName = value => text(typeof value === 'string' ? value : value?.name, 'Emoji');
const route = params => `/rest/v1/reactions?${new URLSearchParams(params)}`;
class MessageReaction {
  constructor(manager, emoji) { Object.defineProperty(this, 'manager', { value: manager }); this.emoji = Object.freeze({ name: emoji }); this.users = { cache: new Collection(), fetch: async () => { await manager.fetch(); return this.users.cache; } }; }
  get message() { return this.manager.message; }
  get count() { return this.users.cache.size; }
  get me() { return this.users.cache.has(this.message.client.userId); }
  remove() { return this.manager.remove(this.emoji.name); }
  toJSON() { return { emoji: this.emoji.name, messageId: this.message.id, count: this.count, me: this.me }; }
}
class ReactionManager {
  #rows = new Collection(); #pending = new Map();
  constructor(message) { Object.defineProperty(this, 'message', { value: message }); this.cache = new Collection(); }
  get client() { return this.message.client; }
  _addRow(row) {
    if (!row?.id || row.message_id !== this.message.id || typeof row.emoji !== 'string' || !row.user_id) throw new YapperError('Invalid reaction record.', 'INVALID_REACTION');
    this.#rows.set(row.id, { ...row }); this.client._reactionRows.set(row.id, { ...row });
    while (this.client._reactionRows.size > 10000) this.client._reactionRows.delete(this.client._reactionRows.keys().next().value);
    let reaction = this.cache.get(row.emoji); if (!reaction) { reaction = new MessageReaction(this, row.emoji); this.cache.set(row.emoji, reaction); }
    const user = this.client.users.cache.get(row.user_id) ?? this.client.users._add({ id: row.user_id });
    reaction.users.cache.set(row.user_id, user); return reaction;
  }
  _removeRow(row) {
    const known = this.#rows.get(row.id) ?? row; this.#rows.delete(row.id); this.client._reactionRows.delete(row.id);
    const reaction = this.cache.get(known.emoji); if (!reaction) return null;
    if (![...this.#rows.values()].some(r => r.emoji === known.emoji && r.user_id === known.user_id)) reaction.users.cache.delete(known.user_id);
    if (!reaction.count) this.cache.delete(known.emoji); return reaction;
  }
  async fetch() {
    const rows = await this.client.rest.get(route({ message_id: `eq.${this.message.id}`, select: 'id,message_id,user_id,emoji' }));
    if (!Array.isArray(rows)) throw new YapperError('Invalid reactions response.', 'INVALID_REACTION');
    const ids = new Set(rows.map(row => row.id));
    for (const [id, row] of this.#rows) if (!ids.has(id)) this._removeRow(row);
    for (const row of rows) this._addRow(row); return this.cache;
  }
  #serialize(emoji, task) {
    const operation = (this.#pending.get(emoji) ?? Promise.resolve()).catch(() => {}).then(task);
    this.#pending.set(emoji, operation);
    operation.finally(() => { if (this.#pending.get(emoji) === operation) this.#pending.delete(emoji); }).catch(() => {});
    return operation;
  }
  add(value) {
    const emoji = emojiName(value);
    return this.#serialize(emoji, async () => {
      if (!this.client.isReady()) throw new AuthenticationError();
      if (this.cache.get(emoji)?.me) return this.cache.get(emoji);
      try {
        const rows = await this.client.rest.post('/rest/v1/reactions?select=id,message_id,user_id,emoji',
          { message_id: this.message.id, user_id: this.client.user.id, emoji }, { headers: { Prefer: 'return=representation' } });
        if (!rows?.[0]) throw new YapperError('No reaction was returned.', 'REACTION_CREATE_FAILED');
        return this._addRow(rows[0]);
      } catch (error) {
        if (error.code !== '23505') throw error;
        await this.fetch(); const reaction = this.cache.get(emoji);
        if (!reaction?.me) throw error; return reaction;
      }
    });
  }
  remove(value) {
    const emoji = emojiName(value);
    return this.#serialize(emoji, async () => {
      if (!this.client.isReady()) throw new AuthenticationError();
      await this.fetch();
      const row = this.#rows.find(row => row.emoji === emoji && row.user_id === this.client.user.id);
      if (!row) return this.message;
      const rows = await this.client.rest.delete(route({ id: `eq.${row.id}`, user_id: `eq.${this.client.user.id}`, message_id: `eq.${this.message.id}`, select: 'id' }), { headers: { Prefer: 'return=representation' } });
      if (!rows?.some(result => result.id === row.id)) throw new YapperError('Reaction was not removed.', 'REACTION_DELETE_FAILED');
      this._removeRow(row); return this.message;
    });
  }
  async removeAll() {
    await this.fetch();
    for (const reaction of [...this.cache.values()]) if (reaction.me) await this.remove(reaction.emoji.name);
    return this.message;
  }
  async setRoles(pairs) {
    if (!Array.isArray(pairs)) throw new TypeError('Reaction roles must be an array.');
    const { resolveId } = require('../managers');
    const data = pairs.map(pair => ({ emoji: emojiName(pair.emoji), role_id: resolveId(pair.roleId) }));
    if (new Set(data.map(pair => pair.emoji)).size !== data.length) throw new TypeError('Reaction role emojis must be unique.');
    await this.client.rest.rpc('set_reaction_roles', { mid: this.message.id, pairs: data });
    for (const pair of data) await this.add(pair.emoji); return this.message;
  }
}
module.exports = { MessageReaction, ReactionManager, emojiName };
