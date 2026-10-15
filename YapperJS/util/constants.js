'use strict';
const Events = Object.freeze({
  ClientReady: 'clientReady', Ready: 'ready', Error: 'error', Warn: 'warn',
  RefreshRetry: 'refreshRetry', SessionInvalidated: 'sessionInvalidated',
  SessionUpdate: 'sessionUpdate', TokenRefresh: 'tokenRefresh',
  MessageCreate: 'messageCreate', MessageUpdate: 'messageUpdate', MessageDelete: 'messageDelete',
  MessageReactionAdd: 'messageReactionAdd', MessageReactionRemove: 'messageReactionRemove',
  CommandStart: 'commandStart', CommandFinish: 'commandFinish', CommandError: 'commandError', CommandRejected: 'commandRejected',
  TypingStart: 'typingStart',
  ChannelCreate: 'channelCreate', ChannelUpdate: 'channelUpdate', ChannelDelete: 'channelDelete',
  RoleCreate: 'roleCreate', RoleUpdate: 'roleUpdate', RoleDelete: 'roleDelete',
  GuildMemberAdd: 'guildMemberAdd', GuildMemberRemove: 'guildMemberRemove', GuildMemberUpdate: 'guildMemberUpdate',
  GuildCreate: 'guildCreate', GuildUpdate: 'guildUpdate', GuildDelete: 'guildDelete',
  UserUpdate: 'userUpdate', PresenceUpdate: 'presenceUpdate', Raw: 'raw', GatewayReady: 'gatewayReady',
  GatewayDisconnect: 'gatewayDisconnect', GatewayReconnect: 'gatewayReconnect', Destroyed: 'destroyed',
});
const ChannelType = Object.freeze({ GuildText: 'text', GuildVoice: 'voice', DM: 'dm', GroupDM: 'group' });
module.exports = { Events, ChannelType };
