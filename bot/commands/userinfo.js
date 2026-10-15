'use strict';
module.exports = { name: 'userinfo', aliases: ['me'], description: 'Show your public profile', cooldown: 2000,
  async execute(ctx) { const user = await ctx.client.users.fetch(ctx.authorId, { force: true }); await ctx.reply(user ? `${user.displayName || user.username || user.id}\nID: ${user.id}\n${user.bio || 'No bio set.'}` : 'Profile unavailable.'); } };
