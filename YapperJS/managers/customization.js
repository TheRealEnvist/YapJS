'use strict';
const { objectOptions, text, channelName, boolean } = require('../util/validation');
const { AuthenticationError, YapperError } = require('../util/errors');
function ready(client) { if (!client.isReady() || !client.user) throw new AuthenticationError(); }
function required(row, message, code) { if (!row) throw new YapperError(message, code); return row; }

function install({ UserManager, ChannelManager, GuildManager, BaseManager, resolveId, query, Collection, User, ClientUser, Channel }) {
  UserManager.prototype._add = function(data) {
    if (data.id === this.client._authUser?.id) {
      const previous = this.cache.get(data.id);
      if (previous instanceof ClientUser) return previous._patch(data);
      const user = new ClientUser(this.client, data);
      if (previous) { Object.assign(user, previous); user._patch(data); }
      this.cache.set(user.id, user); return user;
    }
    return BaseManager.prototype._add.call(this, data);
  };

  ChannelManager.prototype.create = async function(options) {
    ready(this.client); objectOptions(options, ['guildId', 'name', 'type'], 'channel');
    const guildId = resolveId(options.guildId), type = options.type ?? 'text';
    if (!['text', 'voice'].includes(type)) throw new TypeError('New server channels must be text or voice.');
    const name = channelName(options.name, type);
    const id = resolveId(await this.client.rest.rpc('create_channel', { sid: guildId, channel_name: name, channel_kind: type }));
    const channel = required(await this.fetch(id, { force: true }), 'Channel was created but could not be fetched; do not repeat creation blindly.', 'CHANNEL_FETCH_FAILED');
    if (channel.guildId !== guildId) throw new YapperError('Created channel belongs to a different server.', 'CHANNEL_SERVER_MISMATCH');
    this.client.gateway.syncTopics(); return channel;
  };
  ChannelManager.prototype.edit = async function(value, options) {
    ready(this.client); objectOptions(options, ['name', 'noImages'], 'channel');
    const channel = required(await this.fetch(value), 'Channel is unavailable.', 'UNKNOWN_CHANNEL');
    if (!channel.guildId) throw new TypeError('Server channel editing cannot be used for DMs.');
    const patch = {};
    if (options.name !== undefined) patch.name = channelName(options.name, channel.type);
    if (options.noImages !== undefined) patch.no_images = boolean(options.noImages, 'noImages');
    if (!Object.keys(patch).length) throw new TypeError('Supply a name or noImages.');
    const rows = await this.client.rest.patch(query('channels', { id: `eq.${channel.id}`, server_id: `eq.${channel.guildId}`, select: '*' }), patch, { headers: { Prefer: 'return=representation' } });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== channel.id || rows[0].server_id !== channel.guildId) throw new YapperError('Channel was not updated.', 'CHANNEL_UPDATE_FAILED');
    return this._add(rows[0]);
  };
  ChannelManager.prototype.delete = async function(value) {
    ready(this.client); const channel = required(await this.fetch(value), 'Channel is unavailable.', 'UNKNOWN_CHANNEL');
    if (!channel.guildId) throw new TypeError('Server channel deletion cannot be used for DMs.');
    const rows = await this.client.rest.delete(query('channels', { id: `eq.${channel.id}`, server_id: `eq.${channel.guildId}`, select: 'id' }), { headers: { Prefer: 'return=representation' } });
    if (!Array.isArray(rows) || !rows.some(row => row.id === channel.id)) throw new YapperError('Channel was not deleted. Check permissions.', 'CHANNEL_DELETE_FAILED');
    this.cache.delete(channel.id); this.client.gateway.syncTopics(); return channel;
  };
  ChannelManager.prototype.setAccess = async function(value, options) {
    ready(this.client); objectOptions(options, ['private', 'roleIds'], 'channel access');
    const channel = required(await this.fetch(value), 'Channel is unavailable.', 'UNKNOWN_CHANNEL');
    if (!channel.guildId) throw new TypeError('Access settings require a server channel.');
    const isPrivate = boolean(options.private, 'private');
    if (options.roleIds !== undefined && !Array.isArray(options.roleIds)) throw new TypeError('roleIds must be an array.');
    const roles = (options.roleIds ?? []).map(resolveId);
    await this.client.rest.rpc('set_channel_access', { cid: channel.id, make_private: isPrivate, role_ids: isPrivate ? roles : [] });
    return required(await this.fetch(channel.id, { force: true }), 'Access was changed but the channel could not be fetched.', 'CHANNEL_FETCH_FAILED');
  };
  ChannelManager.prototype.setPosting = async function(value, options) {
    ready(this.client); objectOptions(options, ['readOnly', 'roleIds', 'slowmode'], 'channel posting');
    const channel = required(await this.fetch(value), 'Channel is unavailable.', 'UNKNOWN_CHANNEL');
    if (!channel.guildId) throw new TypeError('Posting settings require a server channel.');
    const readOnly = boolean(options.readOnly, 'readOnly'), slow = options.slowmode ?? 0;
    if (!Number.isSafeInteger(slow) || slow < 0) throw new RangeError('slowmode must be a nonnegative integer in seconds.');
    if (options.roleIds !== undefined && !Array.isArray(options.roleIds)) throw new TypeError('roleIds must be an array.');
    const roles = (options.roleIds ?? []).map(resolveId);
    await this.client.rest.rpc('set_channel_posting', { cid: channel.id, make_read_only: readOnly, post_role_ids: readOnly ? roles : [], slow });
    return required(await this.fetch(channel.id, { force: true }), 'Posting settings were changed but the channel could not be fetched.', 'CHANNEL_FETCH_FAILED');
  };

  GuildManager.prototype.create = async function(options) {
    ready(this.client); if (typeof options === 'string') options = { name: options };
    objectOptions(options, ['name', 'icon'], 'server');
    const name = text(options.name, 'Server name'), icon = options.icon === undefined ? null : text(options.icon, 'Icon path', { nullable: true });
    const id = resolveId(await this.client.rest.rpc('create_server', { server_name: name, server_icon: icon }));
    const guild = required(await this.fetch(id, { force: true }), 'Server was created but could not be fetched; do not repeat creation blindly.', 'SERVER_FETCH_FAILED');
    await this.client.channels.fetchGuild(id); this.client.gateway.syncTopics(); return guild;
  };
  GuildManager.prototype.edit = async function(value, options) {
    ready(this.client); objectOptions(options, ['name', 'icon'], 'server');
    if (!Object.keys(options).length) throw new TypeError('Supply a server name or icon.');
    // Fetch the latest row because update_server requires both fields, including an unchanged icon.
    const guild = required(await this.fetch(value, { force: true }), 'Server is unavailable.', 'UNKNOWN_SERVER');
    const name = options.name === undefined ? guild.name : text(options.name, 'Server name');
    const icon = options.icon === undefined ? guild.icon ?? null : text(options.icon, 'Icon path', { nullable: true });
    await this.client.rest.rpc('update_server', { sid: guild.id, server_name: name, server_icon: icon });
    guild._patch({ name, icon_path: icon }); return guild;
  };
  GuildManager.prototype._remove = function(id) {
    const guild = this.cache.get(id) ?? null; this.cache.delete(id); this.client._pendingGuilds.delete(id);
    for (const channel of this.client.channels.cache.values()) if (channel.guildId === id) this.client.channels.cache.delete(channel.id);
    delete this.client._members[id]; this.client.gateway.syncTopics(); return guild;
  };
  GuildManager.prototype.delete = async function(value) { ready(this.client); const id = resolveId(value); await this.client.rest.rpc('delete_server', { sid: id }); return this._remove(id); };
  GuildManager.prototype.leave = async function(value) { ready(this.client); const id = resolveId(value); await this.client.rest.rpc('leave_server', { sid: id }); return this._remove(id); };
  GuildManager.prototype.setDiscovery = async function(value, options) {
    ready(this.client); objectOptions(options, ['discoverable', 'description', 'tags'], 'discovery');
    if (!Object.keys(options).length) throw new TypeError('Supply discovery settings.');
    const guild = required(await this.fetch(value, { force: true }), 'Server is unavailable.', 'UNKNOWN_SERVER');
    const discoverable = options.discoverable === undefined ? guild.discoverable ?? false : boolean(options.discoverable, 'discoverable');
    const description = options.description === undefined ? guild.description ?? '' : text(options.description, 'Server description', { empty: true });
    const tags = options.tags === undefined ? guild.tags ?? [] : options.tags;
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new TypeError('tags must be an array of nonempty strings.');
    await this.client.rest.rpc('set_server_discovery', { sid: guild.id, p_on: discoverable, p_description: description, p_tags: tags });
    guild._patch({ discoverable, description, tags }); return guild;
  };
  GuildManager.prototype.setNickname = async function(value, user, nickname) {
    ready(this.client); const sid = resolveId(value), target = resolveId(user), nick = nickname === null ? '' : text(nickname, 'Nickname', { empty: true });
    await this.client.rest.rpc('set_nickname', { sid, target, nick });
    if (!this.client._isDestroyed) this.client._dispatchMember('UPDATE', { server_id: sid, user_id: target, nickname: nick });
  };

  class GuildChannelManager {
    constructor(guild) { Object.defineProperty(this, 'guild', { value: guild }); Object.defineProperty(this, 'client', { value: guild.client }); }
    get cache() { return this.client.channels.cache.filter(channel => channel.guildId === this.guild.id); }
    resolve(value) { const channel = this.client.channels.cache.get(resolveId(value)); return channel?.guildId === this.guild.id ? channel : null; }
    async fetch(value, options = {}) {
      if (value === undefined) return this.client.channels.fetchGuild(this.guild.id);
      const id = resolveId(value); if (!options.force && this.cache.has(id)) return this.cache.get(id);
      const rows = await this.client.rest.get(query('channels', { select: '*', id: `eq.${id}`, server_id: `eq.${this.guild.id}`, limit: '1' }));
      return rows?.[0] ? this.client.channels._add(rows[0]) : null;
    }
    async #channel(value) { return required(await this.fetch(value), 'Channel is not in this server or is unavailable.', 'CHANNEL_SERVER_MISMATCH'); }
    create(options) { objectOptions(options, ['name', 'type'], 'channel'); return this.client.channels.create({ ...options, guildId: this.guild.id }); }
    async edit(value, options) { const channel = await this.#channel(value); return this.client.channels.edit(channel.id, options); }
    async delete(value) { const channel = await this.#channel(value); return this.client.channels.delete(channel.id); }
    async setPositions(order) {
      ready(this.client); if (!Array.isArray(order) || !order.length) throw new TypeError('Supply a nonempty ordered array of channel IDs.');
      const ids = order.map(resolveId); if (new Set(ids).size !== ids.length) throw new TypeError('Channel IDs must be unique.');
      await this.fetch(); for (const id of ids) if (!this.cache.has(id)) throw new YapperError('Cannot reorder a channel outside this server.', 'CHANNEL_SERVER_MISMATCH');
      await this.client.rest.rpc('reorder_channels', { sid: this.guild.id, ids });
      ids.forEach((id, position) => { this.client.channels.cache.get(id).position = position; }); return this.cache;
    }
  }
  return { GuildChannelManager };
}
module.exports = install;
