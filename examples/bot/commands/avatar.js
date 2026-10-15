'use strict';
module.exports = { name: 'avatar', description: 'Show your profile image', cooldown: 2000,
  async execute(ctx) { const user = await ctx.client.users.fetch(ctx.authorId, { force: true }); const url = user?.displayAvatarURL(); await ctx.reply(url || 'No profile image is set.'); } };
