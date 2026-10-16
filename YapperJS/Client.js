'use strict';
const { EventEmitter, captureRejectionSymbol } = require('node:events');
const path = require('node:path');
const REST = require('./rest/REST');
const AuthManager = require('./auth/AuthManager');
const Gateway = require('./realtime/Gateway');
const { UserManager, ChannelManager, GuildManager, DMManager } = require('./managers');
const { FileSessionStore } = require('./auth/stores');
const { User, Channel, Guild, GuildMember, Message } = require('./structures');
const { Events } = require('./util/constants');
const { PresenceManager, validatePresence } = require('./presence/PresenceManager');
const { CollectorHub } = require('./collectors');
const { CommandManager } = require('./commands');
const { YapperError } = require('./util/errors');

class Client extends EventEmitter {
  #ready = false; #destroyed = false; #loginPromise = null; #seenMessages = new Set(); #reactionEvents = new Set(); #reactionDeletes = new Set();
  constructor(options = {}) {
    super({ captureRejections: true });
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Client options must be an object.');
    const envApiKey = process.env.YAPPER_API_KEY;
    const apiKey = options.apiKey ?? (envApiKey?.trim() ? envApiKey : require('./global').apiKey);
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Set options.apiKey or YAPPER_API_KEY to the public project key.');
    const mediaBaseUrl = options.mediaBaseUrl ?? require('./global').mediaBaseUrl;
    if (typeof mediaBaseUrl !== 'string' || new URL(mediaBaseUrl).protocol !== 'https:') throw new TypeError('mediaBaseUrl must use HTTPS.');
    Object.defineProperty(this, 'apiKey', { value: apiKey });
    const messageCacheMaxSize = options.messageCacheMaxSize ?? 200;
    if (!Number.isInteger(messageCacheMaxSize) || messageCacheMaxSize < 1) throw new TypeError('messageCacheMaxSize must be a positive integer.');
    this.options = Object.freeze({ realtime: options.realtime !== false, messageCacheMaxSize, mediaBaseUrl: mediaBaseUrl.replace(/\/$/, ''), presence: options.presence === undefined ? undefined : validatePresence(options.presence) });
    this.rest = new REST(this, options); this.auth = new AuthManager(this, options); this.gateway = new Gateway(this, options); this.presence = new PresenceManager(this, options.presenceInterval);
    this.users = new UserManager(this); this.channels = new ChannelManager(this); this.guilds = new GuildManager(this); this.servers = this.guilds; this.dms = new DMManager(this);
    Object.defineProperty(this, '_authUser', { value: null, writable: true });
    Object.defineProperty(this, '_channelEvents', { value: new Map() });
    Object.defineProperty(this, '_messageDeletes', { value: new Set() });
    Object.defineProperty(this, '_roleDeletes', { value: new Set() });
    Object.defineProperty(this, '_pendingGuilds', { value: new Map() });
    Object.defineProperty(this, '_memberDeletes', { value: new Set() });
    Object.defineProperty(this, '_reactionRows', { value: new Map() });
    Object.defineProperty(this, '_partialMessages', { value: new Map() });
    Object.defineProperty(this, '_collectorHub', { value: new CollectorHub(this) });
    this.commands = new CommandManager(this, options.commands);
    this.user = null; this.readyAt = null; this.bootstrapData = null; this._members = {};
  }
  get _isDestroyed() { return this.#destroyed; }
  get token() { return this.auth.accessToken; }
  get refresh_token() { return this.auth.refreshToken; }
  get refreshtoken() { return this.auth.refreshToken; }
  get userId() { return this.user?.id ?? null; }
  get botProfile() { return this._authUser; }
  get uptime() { return this.#ready ? Date.now() - this.readyAt.getTime() : null; }
  isReady() { return this.#ready; }
  login(session) {
    if (this.#destroyed) return Promise.reject(new YapperError('This client was destroyed. Create a new Client.', 'CLIENT_DESTROYED'));
    if (this.#loginPromise) return this.#loginPromise;
    if (this.#ready) return Promise.resolve(this);
    this.#loginPromise = (async () => {
      try {
        const user = await this.auth.login(session);
        this.#assertActive(); this._authUser = user; this.user = this.users._add(user);
        await this.fetchBootstrap(); this.#assertActive();
        if (this.options.realtime) await this.gateway.start();
        this.#assertActive(); this.#ready = true; this.readyAt = new Date();
        if (this.options.presence) await this.presence.setPresence(this.options.presence);
        this.#assertActive();
        this.emit(Events.ClientReady, this); this.emit(Events.Ready, this);
        return this;
      } catch (error) {
        this.#ready = false; this.gateway.destroy(); this.presence.destroy(); this.auth.destroy(); this._authUser = null; this.user = null; this.readyAt = null;
        this.users.cache.clear(); this.channels.cache.clear(); this.guilds.cache.clear();
        throw error;
      } finally { this.#loginPromise = null; }
    })();
    return this.#loginPromise;
  }
  #assertActive() { if (this.#destroyed) throw new YapperError('Client was destroyed during login.', 'CLIENT_DESTROYED'); }
  async fetchBootstrap() {
    const data = await this.rest.rpc('bootstrap'); this.#assertActive();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new YapperError('Invalid bootstrap response.', 'INVALID_BOOTSTRAP');
    return this._applyBootstrap(data);
  }
  _applyBootstrap(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new YapperError('Invalid bootstrap response.', 'INVALID_BOOTSTRAP');
    this.bootstrapData = data;
    const users = data.profiles ?? [], servers = data.servers ?? [], channels = [...(data.channels ?? []), ...(data.dm_channels ?? [])];
    for (const row of users) this.users._add(row);
    const serverIds = new Set(servers.map(row => row.id));
    for (const id of this.guilds.cache.keys()) if (!serverIds.has(id)) this.guilds._remove(id);
    for (const row of servers) this.guilds._add(row);
    const ids = new Set(channels.map(row => row.id)); for (const id of this.channels.cache.keys()) if (!ids.has(id)) this.channels.cache.delete(id);
    const dmMembers = new Map(); for (const [channelId, userId] of data.dm_members ?? []) { if (!dmMembers.has(channelId)) dmMembers.set(channelId, []); dmMembers.get(channelId).push(userId); }
    for (const row of channels) this.channels._add(dmMembers.has(row.id) ? { ...row, memberIds: dmMembers.get(row.id) } : row);
    this._members = {}; this._memberDeletes.clear();
    for (const guild of this.guilds.cache.values()) {
      guild.members.clear();
      for (const entry of data.members?.[guild.id] ?? []) {
        const row = Array.isArray(entry) ? { user_id: entry[0], joined_at: entry[1], nickname: entry[2] ?? null } : entry;
        guild.members._add({ ...row, server_id: guild.id }, false);
      }
      guild.members._sync();
    }
    const rolesByGuild = new Map();
    for (const row of data.roles ?? []) { if (!rolesByGuild.has(row.server_id)) rolesByGuild.set(row.server_id, []); rolesByGuild.get(row.server_id).push(row); }
    for (const guild of this.guilds.cache.values()) {
      const roleRows = rolesByGuild.get(guild.id) ?? [], ids = new Set(roleRows.map(row => row.id));
      for (const id of guild.roles.cache.keys()) if (!ids.has(id)) guild.roles._remove(id);
      for (const row of roleRows) guild.roles._add(row);
    }
    for (const entry of data.member_roles ?? []) {
      const row = Array.isArray(entry) ? { server_id: entry[0], user_id: entry[1], role_id: entry[2] } : entry;
      this.guilds.cache.get(row.server_id)?.members.get(row.user_id)?._roleIds.add(row.role_id);
    }
    this._roleDeletes.clear(); this.gateway.syncTopics();
    return data;
  }
  createDM(user, options) { return this.dms.create(user, options); }
  sendDM(user, content) { return this.dms.send(user, content); }
  _invalidateSession(metadata) {
    this.#ready = false; this.readyAt = null; this.gateway.destroy(); this.presence.destroy();
    this.emit(Events.SessionInvalidated, metadata);
  }
  setPresence(options) { return this.presence.setPresence(options); }
  refreshToken() { return this.auth.refresh(); }
  _messageManager(channelId) { let channel = this.channels.cache.get(channelId); if (!channel) channel = this.channels._add({ id: channelId }); return channel.messages; }
  _dispatch(event, payload, hydrated = false) {
    if (!hydrated) this.emit(Events.Raw, event, payload);
    const { table, operation, record, old_record: oldRecord } = payload;
    if (event === 'typing') { this.emit(Events.TypingStart, payload); return; }
    const row = operation === 'DELETE' ? oldRecord : record;
    if (table === 'roles') { this._dispatchRole(operation, row); return; }
    if (table === 'member_roles') { this._dispatchMemberRole(operation, row); return; }
    if (table === 'server_members') { this._dispatchMember(operation, row); return; }
    if (!row?.id) return;
    if (table === 'reactions') { this._dispatchReaction(operation, row); return; }
    if (table === 'messages') {
      if (operation === 'DELETE' && this._messageDeletes.has(row.id)) return;
      const channelId = row.channel_id || this.channels.cache.find(channel => channel.messages.cache.has(row.id))?.id;
      if (!channelId) return;
      if (!hydrated && (!this.channels.cache.has(channelId) || this._channelEvents.has(channelId))) { this._queueChannelEvent(channelId, event, payload); return; }
      const manager = this._messageManager(channelId);
      if (operation === 'INSERT') {
        this._messageDeletes.delete(row.id);
        const message = manager._add(row);
        if (this.#seenMessages.has(message.id)) return;
        this.#seenMessages.add(message.id); while (this.#seenMessages.size > 2000) this.#seenMessages.delete(this.#seenMessages.values().next().value);
        this.emit(Events.MessageCreate, message);
      } else if (operation === 'UPDATE') {
        const old = manager.cache.get(row.id); const snapshot = old ? new Message(this, { id: old.id, channel_id: old.channelId, author_id: old.authorId, content: old.content, created_at: old.createdAt?.toISOString(), edited_at: old.editedTimestamp ? new Date(old.editedTimestamp).toISOString() : null, reply_to_id: old.replyToId }) : null;
        this.emit(Events.MessageUpdate, snapshot, manager._add(row));
      } else if (operation === 'DELETE') {
        const message = manager.cache.get(row.id) ?? new Message(this, { ...row, channel_id: channelId }); this._removeMessage(message);
      }
      return;
    }
    const config = {
      channels: [this.channels, Channel, Events.ChannelCreate, Events.ChannelUpdate, Events.ChannelDelete],
      servers: [this.guilds, Guild, Events.GuildCreate, Events.GuildUpdate, Events.GuildDelete],
      profiles: [this.users, User, null, Events.UserUpdate, null],
    }[table];
    if (!config) return;
    const [manager, Structure, createEvent, updateEvent, deleteEvent] = config;
    const existing = manager.cache.get(row.id);
    if (operation === 'DELETE') { if (table === 'servers') this.guilds._remove(row.id); else manager.cache.delete(row.id); if (deleteEvent) this.emit(deleteEvent, existing ?? new Structure(this, row)); }
    else if (operation === 'UPDATE') {
      let previous = null;
      if (existing) {
        previous = Object.create(Structure.prototype); Object.defineProperty(previous, 'client', { value: this });
        Object.assign(previous, existing);
      }
      const updated = manager._add(row); if (updateEvent) this.emit(updateEvent, previous, updated);
    } else if (operation === 'INSERT' && createEvent) this.emit(createEvent, manager._add(row));
    this.gateway.syncTopics();
  }
  _queueChannelEvent(channelId, event, payload) {
    const existing = this._channelEvents.get(channelId);
    if (existing) { existing.push({ event, payload }); return; }
    const queue = [{ event, payload }]; this._channelEvents.set(channelId, queue);
    Promise.resolve().then(async () => {
      try {
        const channel = await this.channels.fetch(channelId, { force: true });
        if (this.#destroyed) { this.channels.cache.delete(channelId); return; }
        if (!channel) throw new YapperError('Message channel is unavailable.', 'UNKNOWN_CHANNEL');
        if (!channel.guildId) await this.dms._hydrate(channel);
      } catch (error) { if (!this.#destroyed) this._emitError(error); }
      if (!this.#destroyed) for (const entry of queue) {
        try { this._dispatch(entry.event, entry.payload, true); }
        catch { this._emitError(new YapperError('Invalid gateway event.', 'GATEWAY_EVENT_ERROR')); }
      }
    }).finally(() => { if (this._channelEvents.get(channelId) === queue) this._channelEvents.delete(channelId); });
  }
  _removeMessage(message) {
    if (this.#destroyed || this._messageDeletes.has(message.id)) return;
    this.channels.cache.get(message.channelId)?.messages.cache.delete(message.id);
    this._partialMessages.delete(message.id); this.#seenMessages.delete(message.id); this._messageDeletes.add(message.id);
    while (this._messageDeletes.size > 2000) this._messageDeletes.delete(this._messageDeletes.values().next().value);
    this.emit(Events.MessageDelete, message);
  }
  _dispatchRole(operation, row) {
    if (!row?.id || !['INSERT', 'UPDATE', 'DELETE'].includes(operation)) return null;
    const guild = row.server_id ? this.guilds.cache.get(row.server_id) : this.guilds.cache.find(server => server.roles.cache.has(row.id));
    if (!guild) return null;
    const manager = guild.roles, existing = manager.cache.get(row.id);
    const key = JSON.stringify([guild.id, row.id]);
    if (operation === 'DELETE') {
      if (this._roleDeletes.has(key)) return existing ?? null;
      const role = existing ?? new (require('./structures/Role'))(guild, row); manager._remove(row.id); this._roleDeletes.add(key);
      while (this._roleDeletes.size > 2000) this._roleDeletes.delete(this._roleDeletes.values().next().value);
      this.emit(Events.RoleDelete, role); return role;
    }
    const before = existing ? Object.assign(new (require('./structures/Role'))(guild, { id: existing.id }), existing) : null;
    const role = manager._add(row); this._roleDeletes.delete(key);
    if (operation === 'INSERT') { if (!existing) this.emit(Events.RoleCreate, role); }
    else if (!before || JSON.stringify(before.toJSON()) !== JSON.stringify(role.toJSON())) this.emit(Events.RoleUpdate, before, role);
    return role;
  }
  _dispatchMemberRole(operation, row) {
    if (!row?.server_id || !row.user_id || !row.role_id || !['INSERT', 'DELETE'].includes(operation)) return;
    const guild = this.guilds.cache.get(row.server_id); if (!guild) return;
    const existing = guild.members.get(row.user_id);
    if (operation === 'DELETE' && !existing?._roleIds.has(row.role_id)) return;
    if (operation === 'INSERT' && existing?._roleIds.has(row.role_id)) return;
    const before = existing?._clone() ?? null;
    const member = existing ?? guild.members._add({ user_id: row.user_id, server_id: guild.id });
    if (operation === 'INSERT') member._roleIds.add(row.role_id); else member._roleIds.delete(row.role_id);
    this.emit(Events.GuildMemberUpdate, before, member);
  }
  _dispatchMember(operation, row) {
    if (!row?.server_id || !row.user_id || !['INSERT', 'UPDATE', 'DELETE'].includes(operation)) return;
    const guild = this.guilds.cache.get(row.server_id);
    if (operation === 'DELETE' && row.user_id === this.userId) this._pendingGuilds.delete(row.server_id);
    if (!guild) {
      if (operation === 'INSERT' && row.user_id === this.userId) this._hydrateJoinedGuild(row);
      return;
    }
    const existing = guild.members.get(row.user_id);
    if (operation === 'INSERT') {
      const member = guild.members._add(row);
      if (!existing) this.emit(Events.GuildMemberAdd, member);
    } else if (operation === 'UPDATE') {
      const previous = existing?._clone() ?? null;
      const member = guild.members._add(row);
      if (!previous || previous.nickname !== member.nickname || previous.joinedTimestamp !== member.joinedTimestamp) this.emit(Events.GuildMemberUpdate, previous, member);
    } else {
      // Duplicate delivery is common across user/server subscriptions. Keep a
      // bounded tombstone set so uncached removals still emit exactly once.
      const key = JSON.stringify([guild.id, row.user_id]);
      if (this._memberDeletes.has(key)) return;
      const member = existing ?? new GuildMember(guild, row);
      guild.members.delete(row.user_id); guild.members._sync();
      this._memberDeletes.add(key);
      while (this._memberDeletes.size > 2000) this._memberDeletes.delete(this._memberDeletes.values().next().value);
      this.emit(Events.GuildMemberRemove, member);
      if (row.user_id === this.userId) { this.guilds._remove(guild.id); this.emit(Events.GuildDelete, guild); }
      return;
    }
    this._memberDeletes.delete(JSON.stringify([guild.id, row.user_id]));
  }
  _hydrateJoinedGuild(row) {
    if (this._pendingGuilds.has(row.server_id)) return;
    const ticket = {}; this._pendingGuilds.set(row.server_id, ticket);
    // The website also reloads its visible servers after a self-membership event.
    // Guard the response so leaving or destroying during the fetch cannot restore it.
    Promise.resolve().then(() => this.rest.rpc('bootstrap')).then(data => {
      if (this.#destroyed || this._pendingGuilds.get(row.server_id) !== ticket) return;
      const knownGuild = this.guilds.cache.has(row.server_id);
      const knownMember = this.guilds.cache.get(row.server_id)?.members.has(row.user_id);
      this._applyBootstrap(data);
      const guild = this.guilds.cache.get(row.server_id);
      if (!guild) return;
      const member = guild.members._add(row);
      if (!knownGuild) this.emit(Events.GuildCreate, guild);
      if (!knownMember) this.emit(Events.GuildMemberAdd, member);
    }).catch(error => { if (!this.#destroyed) this._emitError(error); })
      .finally(() => { if (this._pendingGuilds.get(row.server_id) === ticket) this._pendingGuilds.delete(row.server_id); });
  }
  _getMessage(id) {
    for (const channel of this.channels.cache.values()) { const message = channel.messages.cache.get(id); if (message) return message; }
    let message = this._partialMessages.get(id);
    if (!message) { message = new Message(this, { id }); this._partialMessages.set(id, message); }
    while (this._partialMessages.size > 1000) this._partialMessages.delete(this._partialMessages.keys().next().value);
    return message;
  }
  _dispatchReaction(operation, incoming) {
    const row = operation === 'DELETE' ? { ...this._reactionRows.get(incoming.id), ...incoming } : incoming;
    if (!row.message_id || !row.user_id || typeof row.emoji !== 'string') return;
    const message = this._getMessage(row.message_id);
    const user = this.users.cache.get(row.user_id) ?? this.users._add({ id: row.user_id });
    if (operation === 'INSERT') {
      if (this.#reactionEvents.has(row.id) || this.#reactionDeletes.has(row.id)) return;
      const reaction = message.reactions._addRow(row); this.#reactionEvents.add(row.id);
      while (this.#reactionEvents.size > 10000) this.#reactionEvents.delete(this.#reactionEvents.values().next().value);
      this.emit(Events.MessageReactionAdd, reaction, user);
    } else if (operation === 'DELETE') {
      if (this.#reactionDeletes.has(row.id)) return;
      // Preserve an event object even when the last user was removed from the cache.
      const previous = message.reactions.cache.get(row.emoji);
      const reaction = message.reactions._removeRow(row) ?? previous ?? new (require('./reactions').MessageReaction)(message.reactions, row.emoji);
      this.#reactionDeletes.add(row.id); this.#reactionEvents.delete(row.id);
      while (this.#reactionDeletes.size > 10000) this.#reactionDeletes.delete(this.#reactionDeletes.values().next().value);
      if (reaction) this.emit(Events.MessageReactionRemove, reaction, user);
    }
    while (this._reactionRows.size > 10000) this._reactionRows.delete(this._reactionRows.keys().next().value);
  }
  _emitError(error) { if (this.listenerCount(Events.Error)) this.emit(Events.Error, error); else this.emit(Events.Warn, error.message); }
  [captureRejectionSymbol]() { this._emitError(new YapperError('An asynchronous event listener rejected.', 'LISTENER_ERROR')); }
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true; this.#ready = false; this._memberDeletes.clear(); this._pendingGuilds.clear(); this._channelEvents.clear(); this._messageDeletes.clear(); this._roleDeletes.clear(); this.commands.destroy(); this._collectorHub.destroy(); this._reactionRows.clear(); this._partialMessages.clear(); this.#reactionEvents.clear(); this.#reactionDeletes.clear(); this.gateway.destroy(); this.presence.destroy(); this.auth.destroy(); this._authUser = null; this.user = null; this.readyAt = null;
    this.users.cache.clear(); this.channels.cache.clear(); this.guilds.cache.clear(); this.#seenMessages.clear(); this.bootstrapData = null; this._members = {};
    this.emit(Events.Destroyed);
  }
  toJSON() { return { ready: this.isReady(), user: this.user?.toJSON() ?? null, readyAt: this.readyAt, guildCount: this.guilds.cache.size, channelCount: this.channels.cache.size }; }
  static async create(yapperValue, apiKey, insecureLogin = false) {
    const sessionStore = insecureLogin ? new FileSessionStore(path.join(process.cwd(), '.data', 'yapper-session.json')) : undefined;
    const client = new this({ apiKey, sessionStore, realtime: false });
    // Preserve the old opt-in behavior: prefer the latest locally saved pair.
    const saved = sessionStore ? await sessionStore.load() : null;
    await client.login(saved ?? yapperValue);
    return client;
  }
}
module.exports = Client;
