'use strict';
module.exports = {
  Client: require('./Client'), Yapper: require('./Client'),
  PresenceManager: require('./presence/PresenceManager').PresenceManager,
  Collection: require('./util/Collection'), REST: require('./rest/REST'),
  ...require('./util/constants'), ...require('./util/errors'),
  Role: require('./structures/Role'),
  GuildRoleManager: require('./managers/moderation').GuildRoleManager,
  GuildMemberRoleManager: require('./managers/moderation').GuildMemberRoleManager,
  GuildBan: require('./managers/moderation').GuildBan,
  GuildBanManager: require('./managers/moderation').GuildBanManager,
  ...require('./reactions'), ...require('./collectors'), ...require('./commands'), ...require('./interactions'),
  ...require('./structures'), ...require('./managers'), ...require('./auth/stores'),
  decodeYapperValue: require('./auth/session').decodeYapperValue,
};
