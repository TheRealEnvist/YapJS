'use strict';
module.exports = { name: 'menu', description: 'Try reaction buttons', cooldown: 10000,
  async execute(ctx) {
    await ctx.channel.sendReactionMenu({ content: 'Choose an action. Only you can use these controls.', allowedUserIds: [ctx.authorId], time: 30000,
      buttons: [{ customId: 'hello', label: 'Say hello', emoji: '👋' }, { customId: 'close', label: 'Close', emoji: '⏹️' }],
      async onSelect(interaction) { if (interaction.customId === 'close') interaction.stop('closed'); else await interaction.reply('Hello!'); } });
  } };
