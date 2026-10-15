"use strict";
const Collection = require('../util/Collection');
const GuildMember = require('../structures/GuildMember');

// Retains Collection helpers (including .size) while supporting .members.cache.
class GuildMemberManager extends Collection {
  constructor(guild) {
    super(); Object.defineProperty(this, 'guild', { value: guild });
    Object.defineProperty(this, 'client', { value: guild.client });
  }
  get cache() { return this; }
  resolve(value) { const { resolveId } = require('./index'); return this.get(resolveId(value)) ?? null; }
  _add(data, sync = true) {
    if (!data?.user_id) throw new TypeError('Member is missing a user ID.');
    let member = this.get(data.user_id);
    if (member) member._patch(data);
    else { member = new GuildMember(this.guild, data); this.set(member.id, member); }
    if (sync) this._sync(); return member;
  }
  _sync() { this.client._members[this.guild.id] = this.map(member => ({ server_id: member.guildId, user_id: member.id, nickname: member.nickname, ...(member.joinedAt ? { joined_at: member.joinedAt.toISOString() } : {}) })); }
  kick(value) { return require('./moderation').kick(this.guild, value); }
  ban(value) { return this.guild.bans.create(value); }
  timeout(value, duration, reason) { return require('./moderation').timeout(this.guild, value, duration, reason); }
  setNickname(value, nickname) {
    const id = require('./moderation').resolveMemberId(this.guild, value);
    return this.guild.setNickname(id, nickname);
  }
  async fetch(value, { force = false } = {}) {
    if (value === undefined) return this.cache;
    const { resolveId } = require('./index'); const id = resolveId(value);
    if (!force && this.has(id)) return this.get(id);
    const params = new URLSearchParams({ select: 'server_id,user_id,nickname,joined_at', server_id: `eq.${this.guild.id}`, user_id: `eq.${id}`, limit: '1' });
    const rows = await this.client.rest.get(`/rest/v1/server_members?${params}`);
    if (this.client._isDestroyed || this.client.guilds.cache.get(this.guild.id) !== this.guild) return null;
    return rows?.[0] ? this._add(rows[0]) : null;
  }
}
module.exports = GuildMemberManager;
