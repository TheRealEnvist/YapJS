'use strict';
module.exports = { name: 'ping', aliases: ['pong'], description: 'Check that the bot responds', cooldown: 2000,
  async execute(ctx) { await ctx.reply('Pong!'); } };
