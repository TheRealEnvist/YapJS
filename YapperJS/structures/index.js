'use strict';
const GuildMember = require('./GuildMember');

class Base {
  constructor(client, data) { Object.defineProperty(this, 'client', { value: client }); this._patch(data); }
  _patch(data) { if (data?.id) this.id = data.id; return this; }
  toString() { return this.id; }
}
class User extends Base {
  _patch(data) {
    super._patch(data);
    const metadata = data.user_metadata ?? {};
    for (const [key, value] of Object.entries({ username: data.username ?? metadata.username, displayName: data.display_name !== undefined ? data.display_name : metadata.display_name, avatar: data.avatar_path !== undefined ? data.avatar_path : metadata.avatar_path, banner: data.banner_path, bio: data.bio, customStatus: data.custom_status, pronouns: data.pronouns, accentColor: data.accent_color, accentColor2: data.accent_color2, bot: data.is_bot ?? metadata.is_bot })) if (value !== undefined) this[key] = value;
    return this;
  }
  displayAvatarURL() { return this.avatar ? `${this.client.rest.baseUrl}/storage/v1/object/public/avatars/${this.avatar.split('/').map(encodeURIComponent).join('/')}` : null; }
  get dmChannel() { return this.client.dms._find(this.id) ?? null; }
  createDM(options) { return this.client.dms.create(this.id, options); }
  async send(content) { return (await this.createDM()).send(content); }
  toString() { return `@${this.username || this.id}`; }
  toJSON() { return { id: this.id, username: this.username, displayName: this.displayName, avatar: this.avatar, bio: this.bio, customStatus: this.customStatus, pronouns: this.pronouns, accentColor: this.accentColor, accentColor2: this.accentColor2, banner: this.banner, bot: this.bot ?? false }; }
}
class Channel extends Base {
  constructor(client, data) { super(client, data); const { MessageManager } = require('../managers'); this.messages = new MessageManager(this); }
  _patch(data) { super._patch(data); for (const [key, value] of Object.entries({ name: data.name, type: data.kind, guildId: data.server_id, topic: data.topic, position: data.position, memberIds: data.memberIds, noImages: data.no_images, readOnly: data.read_only, slowmode: data.slowmode, private: data.private })) if (value !== undefined) this[key] = value; return this; }
  get guild() { return this.guildId ? this.client.guilds.cache.get(this.guildId) ?? null : null; }
  isDMBased() { return !this.guildId && (this.type === 'dm' || this.type === 'group' || Array.isArray(this.memberIds)); }
  isTextBased() { return this.type !== 'voice'; }
  async send(content) { if (!this.isTextBased()) throw new TypeError('Cannot send a text message to a voice channel.'); return this.messages.create(content); }
  createMessageCollector(options) { const { MessageCollector } = require('../collectors'); return new MessageCollector(this, options); }
  awaitMessages(options) { return require('../collectors').awaitCollected(this.createMessageCollector(options)); }
  sendTyping() { return this.client.gateway.sendTyping(this.id, this.isDMBased() ? this.memberIds?.filter(id => id !== this.client.userId) : undefined); }
  sendReactionMenu(options) { return require('../interactions').ReactionMenu.send(this, options); }
  paginate(pages, options) { return require('../interactions').ReactionMenu.paginate(this, pages, options); }
  confirm(options) { return require('../interactions').ReactionMenu.confirm(this, options); }
  createPoll(options) { return require('../interactions').ReactionPoll.create(this, options); }
  edit(options) { return this.client.channels.edit(this.id, options); }
  setName(name) { return this.edit({ name }); }
  setNoImages(noImages) { return this.edit({ noImages }); }
  setAccess(options) { return this.client.channels.setAccess(this.id, options); }
  setPosting(options) { return this.client.channels.setPosting(this.id, options); }
  delete() { return this.client.channels.delete(this.id); }
  bulkDelete(messages) { return this.messages.bulkDelete(messages); }
  toJSON() { return { id: this.id, name: this.name, type: this.type, guildId: this.guildId ?? null, topic: this.topic, noImages: this.noImages, readOnly: this.readOnly, slowmode: this.slowmode, private: this.private }; }
}
class Guild extends Base {
  constructor(client, data) { super(client, data); const { GuildChannelManager } = require('../managers'); Object.defineProperty(this, 'channels', { value: new GuildChannelManager(this), enumerable: true }); Object.defineProperty(this, 'members', { value: new (require('../managers/GuildMemberManager'))(this), enumerable: true }); const { GuildRoleManager, GuildBanManager } = require('../managers/moderation'); Object.defineProperty(this, 'roles', { value: new GuildRoleManager(this), enumerable: true }); Object.defineProperty(this, 'bans', { value: new GuildBanManager(this), enumerable: true }); }
  _patch(data) { super._patch(data); for (const [key, value] of Object.entries({ name: data.name, ownerId: data.owner_id, icon: data.icon_path, description: data.description, discoverable: data.discoverable, tags: data.tags, tag: data.tag })) if (value !== undefined) this[key] = value; return this; }
  edit(options) { return this.client.guilds.edit(this.id, options); }
  setName(name) { return this.edit({ name }); }
  setIcon(icon) { return this.edit({ icon }); }
  setDescription(description) { return this.setDiscovery({ description }); }
  setDiscovery(options) { return this.client.guilds.setDiscovery(this.id, options); }
  setNickname(user, nickname) { return this.client.guilds.setNickname(this.id, user, nickname); }
  leave() { return this.client.guilds.leave(this.id); }
  delete() { return this.client.guilds.delete(this.id); }
  toJSON() { return { id: this.id, name: this.name, ownerId: this.ownerId, icon: this.icon, description: this.description, discoverable: this.discoverable, tags: this.tags, tag: this.tag }; }
}
class Message extends Base {
  constructor(client, data) { super(client, data); const { ReactionManager } = require('../reactions'); Object.defineProperty(this, 'reactions', { value: new ReactionManager(this), enumerable: true }); }
  _patch(data) { super._patch(data); for (const [key, value] of Object.entries({ channelId: data.channel_id, authorId: data.author_id, content: data.content, createdTimestamp: data.created_at ? Date.parse(data.created_at) : undefined, editedTimestamp: data.edited_at === null ? null : data.edited_at ? Date.parse(data.edited_at) : undefined, replyToId: data.reply_to_id, attachmentPath: data.attachment_path })) if (value !== undefined) this[key] = value; return this; }
  get partial() { return !this.channelId || this.content === undefined; }
  async fetch() {
    const params = new URLSearchParams({ id: `eq.${this.id}`, select: '*', limit: '1' });
    const rows = await this.client.rest.get(`/rest/v1/messages?${params}`);
    if (!rows?.[0]?.channel_id) throw new Error('Message is unavailable');
    return this.client._messageManager(rows[0].channel_id)._add(rows[0]);
  }
  react(emoji) { return this.reactions.add(emoji); }
  createReactionCollector(options) { const { ReactionCollector } = require('../collectors'); return new ReactionCollector(this, options); }
  awaitReactions(options) { const { awaitCollected } = require('../collectors'); return awaitCollected(this.createReactionCollector(options)); }
  createReactionMenu(options) { return require('../interactions').ReactionMenu.create(this, options); }
  setReactionRoles(pairs) { return this.reactions.setRoles(pairs); }
  get channel() { return this.client.channels.cache.get(this.channelId) ?? null; }
  get author() { return this.client.users.cache.get(this.authorId) ?? null; }
  get guild() { return this.channel?.guild ?? null; }
  get guildId() { return this.channel?.guildId ?? null; }
  get member() { return this.authorId ? this.guild?.members.resolve(this.authorId) ?? null : null; }
  inGuild() { return this.guildId !== null; }
  get createdAt() { return Number.isFinite(this.createdTimestamp) ? new Date(this.createdTimestamp) : null; }
  async reply(content) { const channel = this.channel ?? await this.client.channels.fetch(this.channelId); if (!channel) throw new Error('Channel is unavailable'); return channel.send({ ...(typeof content === 'string' ? { content } : content), replyTo: this.id }); }
  async edit(content) { return this.client._messageManager(this.channelId).edit(this.id, content); }
  async delete() { await this.client._messageManager(this.channelId).delete(this.id); return this; }
  toString() { return this.content || ''; }
  toJSON() { return { id: this.id, channelId: this.channelId, authorId: this.authorId, content: this.content, createdTimestamp: this.createdTimestamp, editedTimestamp: this.editedTimestamp, replyToId: this.replyToId, attachmentPath: this.attachmentPath }; }
}
module.exports = { User, Channel, Guild, Server: Guild, GuildMember, Message };
module.exports.ClientUser = require('./ClientUser');
