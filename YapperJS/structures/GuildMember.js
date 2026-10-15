"use strict";

class GuildMember {
  constructor(guild, data) {
    Object.defineProperty(this, 'guild', { value: guild });
    Object.defineProperty(this, 'client', { value: guild.client });
    this.guildId = guild.id; this.nickname = null; this.joinedTimestamp = null;
    Object.defineProperty(this, '_roleIds', { value: new Set() });
    Object.defineProperty(this, 'roles', { value: new (require('../managers/moderation').GuildMemberRoleManager)(this), enumerable: true });
    this._patch(data);
  }
  _patch(data) {
    if (data.server_id && data.server_id !== this.guildId) throw new TypeError('Member belongs to another server.');
    if (data.user_id) this.id = data.user_id;
    if (data.nickname !== undefined) this.nickname = data.nickname || null;
    if (data.joined_at !== undefined) {
      const timestamp = typeof data.joined_at === 'number' ? data.joined_at * 1000 : Date.parse(data.joined_at);
      this.joinedTimestamp = Number.isFinite(timestamp) ? timestamp : null;
    }
    return this;
  }
  get user() { return this.client.users.cache.get(this.id) ?? null; }
  get displayName() { return this.nickname ?? this.user?.displayName ?? this.user?.username ?? this.id; }
  get joinedAt() { return this.joinedTimestamp === null ? null : new Date(this.joinedTimestamp); }
  get partial() { return this.joinedTimestamp === null; }
  _clone() {
    const previous = new GuildMember(this.guild, { user_id: this.id, nickname: this.nickname, ...(this.joinedAt ? { joined_at: this.joinedAt.toISOString() } : {}) });
    for (const id of this._roleIds) previous._roleIds.add(id); return previous;
  }
  kick() { return this.guild.members.kick(this); }
  ban() { return this.guild.bans.create(this); }
  timeout(duration, reason) { return this.guild.members.timeout(this, duration, reason); }
  fetch() { return this.guild.members.fetch(this.id, { force: true }); }
  setNickname(nickname) { return this.guild.setNickname(this.id, nickname); }
  toString() { return `@${this.displayName}`; }
  toJSON() { return { id: this.id, guildId: this.guildId, nickname: this.nickname, joinedTimestamp: this.joinedTimestamp }; }
}
module.exports = GuildMember;
