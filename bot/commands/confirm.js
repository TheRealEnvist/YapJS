'use strict';
module.exports = { name: 'confirm', description: 'Try a confirmation prompt', cooldown: 10000,
  async execute(ctx) { const result = await ctx.channel.confirm({ content: 'Confirm this example action?', allowedUserIds: [ctx.authorId], time: 30000 }); await ctx.reply(result.confirmed ? 'Confirmed.' : result.reason === 'time' ? 'The prompt timed out.' : 'Cancelled.'); } };
