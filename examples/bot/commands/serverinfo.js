'use strict';
module.exports = { name: 'serverinfo', aliases: ['guildinfo'], description: 'Show this server', guildOnly: true, cooldown: 2000,
  async execute(ctx) { await ctx.reply(`${ctx.guild.name}\nChannels cached: ${ctx.guild.channels.cache.size}\nMembers cached: ${ctx.guild.members.size}`); } };
