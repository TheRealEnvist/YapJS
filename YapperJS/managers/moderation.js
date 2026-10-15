'use strict';
const Collection = require('../util/Collection');
const Role = require('../structures/Role');
const { objectOptions, text, boolean } = require('../util/validation');
const { AuthenticationError, YapperError, YapperAPIError } = require('../util/errors');
const { Events } = require('../util/constants');
const idOf = value => require('./index').resolveId(value);
function ready(client) { if (!client.isReady() || !client.user || client._isDestroyed) throw new AuthenticationError(); }
function active(guild) { ready(guild.client); if (guild.client.guilds.cache.get(guild.id) !== guild) throw new YapperError('Server is unavailable.', 'UNKNOWN_SERVER'); }
const query = (table, params) => `/rest/v1/${table}?${new URLSearchParams(params)}`;
const representation = { headers: { Prefer: 'return=representation' } };
function ownId(guild, value) {
  if (value?.guildId && value.guildId !== guild.id) throw new YapperError('Entity belongs to another server.', 'SERVER_MISMATCH');
  return idOf(value);
}
async function rows(client, table, filter) {
  const all = [], limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = await client.rest.get(query(table, { ...filter, limit: String(limit), offset: String(offset) }));
    if (!Array.isArray(page)) throw new YapperError('Invalid list response.', 'INVALID_RESPONSE');
    all.push(...page); if (page.length < limit) return all;
  }
}
function roleOptions(options, create = false) {
  objectOptions(options, create ? ['name', 'color', 'position', 'manageServer', 'manageMessages'] : ['name', 'color', 'color2', 'position', 'manageServer', 'manageMessages', 'permissions', 'auto', 'autoBefore'], 'role');
  const data = {};
  if (options.name !== undefined) data.name = text(options.name, 'Role name', { max: 100 });
  for (const key of ['color', 'color2']) if (options[key] !== undefined) {
    const color = options[key]; if (color !== null && (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color))) throw new TypeError('Role color must be #RRGGBB or null.'); data[key] = color;
  }
  if (options.position !== undefined) { if (!Number.isSafeInteger(options.position) || options.position < 0) throw new RangeError('Role position must be a nonnegative integer.'); data.position = options.position; }
  for (const [key, column] of [['manageServer', 'manage_server'], ['manageMessages', 'manage_messages']]) if (options[key] !== undefined) data[column] = boolean(options[key], key);
  if (options.permissions !== undefined) {
    const value = options.permissions; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('permissions must map Yapper permission names to booleans.');
    data.perms = {};
    for (const [key, enabled] of Object.entries(value)) { if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) throw new TypeError('Invalid permission name.'); Object.defineProperty(data.perms, key, { value: boolean(enabled, key), enumerable: true }); }
  }
  if (options.auto !== undefined) { if (!['none', 'all', 'before'].includes(options.auto)) throw new TypeError('Invalid automatic role mode.'); data.auto = options.auto; }
  if (options.autoBefore !== undefined) {
    if (options.autoBefore === null) data.auto_before = null;
    else { const timestamp = new Date(options.autoBefore); if (!Number.isFinite(timestamp.getTime())) throw new TypeError('autoBefore must be a valid timestamp.'); data.auto_before = timestamp.toISOString(); }
  }
  return data;
}
class GuildRoleManager {
  #creates = Promise.resolve();
  constructor(guild) { Object.defineProperty(this, 'guild', { value: guild }); Object.defineProperty(this, 'client', { value: guild.client }); this.cache = new Collection(); }
  resolve(value) { return this.cache.get(ownId(this.guild, value)) ?? null; }
  _add(data) {
    if (!data?.id) throw new TypeError('Role is missing an ID.');
    const existing = this.cache.get(data.id); if (existing) return existing._patch(data);
    const role = new Role(this.guild, data); this.cache.set(role.id, role); return role;
  }
  _remove(id) { const role = this.cache.get(id) ?? null; this.cache.delete(id); for (const member of this.guild.members.values()) member._roleIds.delete(id); return role; }
  async fetch(value, { force = false } = {}) {
    active(this.guild);
    if (value !== undefined) {
      const id = ownId(this.guild, value); if (!force && this.cache.has(id)) return this.cache.get(id);
      const data = await this.client.rest.get(query('roles', { select: '*', server_id: `eq.${this.guild.id}`, id: `eq.${id}`, limit: '1' })); active(this.guild);
      return data?.[0] ? this._add(data[0]) : null;
    }
    const data = await rows(this.client, 'roles', { select: '*', server_id: `eq.${this.guild.id}`, order: 'position.desc,id.asc' }); active(this.guild);
    const ids = new Set(data.map(row => row.id)); for (const id of this.cache.keys()) if (!ids.has(id)) this._remove(id);
    for (const row of data) this._add(row); return this.cache;
  }
  create(options = {}) {
    const data = roleOptions(options, true);
    const operation = this.#creates.then(async () => {
      active(this.guild); await this.fetch(); active(this.guild);
      const position = data.position ?? Math.max(0, ...this.cache.map(role => role.position ?? 0)) + 1;
      const response = await this.client.rest.post('/rest/v1/roles?select=*', { server_id: this.guild.id, name: data.name ?? 'new role', color: data.color ?? null, position, manage_server: data.manage_server ?? false, manage_messages: data.manage_messages ?? false }, representation); active(this.guild);
      if (!response?.[0]) throw new YapperError('Role creation returned no record.', 'ROLE_CREATE_FAILED');
      return this._accept('INSERT', response[0]);
    });
    this.#creates = operation.catch(() => {}); return operation;
  }
  async edit(value, options) {
    active(this.guild); const data = roleOptions(options); if (!Object.keys(data).length) throw new TypeError('Supply role settings.');
    const role = await this.fetch(value); if (!role) throw new YapperError('Role is unavailable in this server.', 'UNKNOWN_ROLE');
    if (data.auto !== undefined && data.auto !== 'before') data.auto_before = null;
    if ((data.auto ?? role.auto) === 'before' && !(data.auto_before !== undefined ? data.auto_before : role.autoBefore)) throw new TypeError('Automatic before roles require autoBefore.');
    if (data.color === null) data.color2 = null;
    const response = await this.client.rest.patch(query('roles', { id: `eq.${role.id}`, server_id: `eq.${this.guild.id}`, select: '*' }), data, representation); active(this.guild);
    if (!response?.[0]) throw new YapperError('Role was not edited.', 'ROLE_EDIT_FAILED'); return this._accept('UPDATE', response[0]);
  }
  async delete(value) {
    active(this.guild); const id = ownId(this.guild, value);
    const response = await this.client.rest.delete(query('roles', { id: `eq.${id}`, server_id: `eq.${this.guild.id}`, select: '*' }), representation); active(this.guild);
    if (!response?.[0]) throw new YapperError('Role was not deleted.', 'ROLE_DELETE_FAILED'); return this._accept('DELETE', response[0]);
  }
  async setPositions(values) {
    active(this.guild); if (!Array.isArray(values) || !values.length) throw new TypeError('Supply role IDs in highest-first order.');
    const ids = values.map(value => ownId(this.guild, value)); if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate role IDs.');
    await this.fetch(); if (ids.some(id => !this.cache.has(id))) throw new YapperError('Role is unavailable in this server.', 'UNKNOWN_ROLE');
    await this.client.rest.rpc('reorder_roles', { sid: this.guild.id, ids }); active(this.guild);
    ids.forEach((id, index) => this._accept('UPDATE', { id, server_id: this.guild.id, position: ids.length - 1 - index })); return this.cache;
  }
  _accept(operation, row) { if (row.server_id && row.server_id !== this.guild.id) throw new TypeError('Role response belongs to another server.'); return this.client._dispatchRole(operation, { ...row, server_id: this.guild.id }); }
}
class GuildBan {
  constructor(guild, data) { Object.defineProperty(this, 'guild', { value: guild }); Object.defineProperty(this, 'client', { value: guild.client }); this.guildId = guild.id; this.id = data.user_id; this.createdTimestamp = data.created_at ? Date.parse(data.created_at) : null; }
  get user() { return this.client.users.cache.get(this.id) ?? null; }
  get createdAt() { return Number.isFinite(this.createdTimestamp) ? new Date(this.createdTimestamp) : null; }
  remove() { return this.guild.bans.remove(this.id); }
  toJSON() { return { id: this.id, guildId: this.guildId, createdTimestamp: this.createdTimestamp }; }
}
class GuildBanManager {
  constructor(guild) { Object.defineProperty(this, 'guild', { value: guild }); Object.defineProperty(this, 'client', { value: guild.client }); this.cache = new Collection(); }
  async fetch(value) {
    active(this.guild); const id = value === undefined ? null : ownId(this.guild, value);
    const filter = { select: 'user_id,created_at', server_id: `eq.${this.guild.id}`, order: 'created_at.desc,user_id.asc' }; if (id) filter.user_id = `eq.${id}`;
    const data = await rows(this.client, 'server_bans', filter); active(this.guild);
    const result = new Collection(data.map(row => { const ban = new GuildBan(this.guild, row); return [ban.id, ban]; }));
    if (!id) this.cache = result; else if (result.has(id)) this.cache.set(id, result.get(id)); else this.cache.delete(id);
    return id ? result.get(id) ?? null : this.cache;
  }
  async create(value) {
    active(this.guild); const target = ownId(this.guild, value); await this.client.rest.rpc('ban_member', { sid: this.guild.id, target }); active(this.guild);
    const ban = new GuildBan(this.guild, { user_id: target }); this.cache.set(target, ban);
    this.client._dispatchMember('DELETE', { server_id: this.guild.id, user_id: target }); return ban;
  }
  async remove(value) {
    active(this.guild); const target = ownId(this.guild, value); await this.client.rest.rpc('unban_member', { sid: this.guild.id, target }); active(this.guild); this.cache.delete(target);
  }
}
class GuildMemberRoleManager {
  constructor(member) { Object.defineProperty(this, 'member', { value: member }); Object.defineProperty(this, 'guild', { value: member.guild }); Object.defineProperty(this, 'client', { value: member.client }); }
  get cache() { return this.guild.roles.cache.filter(role => this.member._roleIds.has(role.id) || role.auto === 'all' || role.auto === 'before' && this.member.joinedTimestamp !== null && this.member.joinedTimestamp < Date.parse(role.autoBefore)); }
  async add(value) {
    active(this.guild); const role = await this.guild.roles.fetch(value); if (!role) throw new YapperError('Role is unavailable in this server.', 'UNKNOWN_ROLE');
    if (role.auto !== 'none') throw new YapperError('Automatic roles cannot be manually assigned.', 'AUTOMATIC_ROLE');
    try { await this.client.rest.post('/rest/v1/member_roles', { server_id: this.guild.id, user_id: this.member.id, role_id: role.id }); }
    catch (error) { if (!(error instanceof YapperAPIError && error.code === '23505')) throw error; }
    active(this.guild); this.client._dispatchMemberRole('INSERT', { server_id: this.guild.id, user_id: this.member.id, role_id: role.id }); return this.member;
  }
  async remove(value) {
    active(this.guild); const role = await this.guild.roles.fetch(value); if (!role) throw new YapperError('Role is unavailable in this server.', 'UNKNOWN_ROLE');
    if (role.auto !== 'none') throw new YapperError('Automatic roles cannot be manually removed.', 'AUTOMATIC_ROLE');
    await this.client.rest.delete(query('member_roles', { server_id: `eq.${this.guild.id}`, user_id: `eq.${this.member.id}`, role_id: `eq.${role.id}` })); active(this.guild);
    this.client._dispatchMemberRole('DELETE', { server_id: this.guild.id, user_id: this.member.id, role_id: role.id }); return this.member;
  }
}
async function kick(guild, value) {
  active(guild); const target = ownId(guild, value); await guild.client.rest.rpc('kick_member', { sid: guild.id, target }); active(guild);
  guild.client._dispatchMember('DELETE', { server_id: guild.id, user_id: target });
}
async function timeout(guild, value, duration, reason = '') {
  active(guild); const target = ownId(guild, value);
  if (!Number.isSafeInteger(duration) || duration < 60000 || duration % 60000 !== 0) throw new RangeError('Timeout duration is positive milliseconds in whole minutes.');
  await guild.client.rest.rpc('server_timeout', { sid: guild.id, target, minutes: duration / 60000, why: text(reason, 'Timeout reason', { empty: true, max: 200 }) }); active(guild);
}
module.exports = { Role, GuildRoleManager, GuildMemberRoleManager, GuildBan, GuildBanManager, kick, timeout, resolveMemberId: ownId };
