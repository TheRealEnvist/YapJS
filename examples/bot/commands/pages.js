'use strict';
module.exports = { name: 'pages', description: 'Try a reaction paginator', cooldown: 10000,
  async execute(ctx) { await ctx.channel.paginate(['First page: welcome!\nRemove and add your reaction to use the same arrow again.', 'Second page: use the arrow reactions to navigate.', 'Third page: use the stop reaction to close.'], { allowedUserIds: [ctx.authorId], time: 60000 }); } };
