"use strict";
const { Events } = require('yapperjs');

module.exports = function registerEvents(client, options = {}) {
  const log = options.log ?? console.log;
  async function announce(member, text) {
    const channelId = options.welcomeChannels?.[member.guildId];
    if (!channelId) return;
    const channel = member.guild.channels.resolve(channelId);
    if (channel?.isTextBased()) await channel.send(text);
  }
  client.on(Events.GuildMemberAdd, async member => {
    log(`${member.displayName} joined ${member.guild.name ?? member.guildId}.`);
    if (member.id !== client.userId) await announce(member, `Welcome ${member.displayName}!`);
  });
  client.on(Events.GuildMemberRemove, async member => {
    log(`${member.displayName} left or was removed from ${member.guild.name ?? member.guildId}.`);
    if (member.id !== client.userId) await announce(member, `${member.displayName} left the server.`);
  });
  client.on(Events.GuildMemberUpdate, (previous, member) => {
    log(`Member updated in ${member.guild.name ?? member.guildId}: ${previous?.displayName ?? member.id} → ${member.displayName}`);
  });
  client.on(Events.GuildCreate, guild => log(`Server added: ${guild.name ?? guild.id}`));
  client.on(Events.GuildDelete, guild => log(`Server removed: ${guild.name ?? guild.id}`));
  // Opt in to message logging; it can contain private server content.
  if (options.logMessages) {
    client.on(Events.MessageCreate, message => {
      if (!message.inGuild()) return;
      log(`[${message.guild?.name ?? message.guildId}/#${message.channel?.name ?? message.channelId}] ${message.member?.displayName ?? message.author?.username ?? message.authorId}: ${message.content ?? ''}`);
    });
    client.on(Events.MessageUpdate, (previous, message) => {
      if (message.inGuild()) log(`Message edited in ${message.guildId}/${message.channelId}: ${message.id}`);
    });
    client.on(Events.MessageDelete, message => {
      if (message.inGuild()) log(`Message deleted in ${message.guildId}/${message.channelId}: ${message.id}`);
    });
  }
};
