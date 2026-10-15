'use strict';
module.exports = { name: 'poll', description: 'Create a reaction poll', usage: 'Question | Option A | Option B', minArgs: 1, cooldown: 10000,
  async execute(ctx) {
    const [question, ...choices] = ctx.rawArgs.split('|').map(part => part.trim());
    if (!question || choices.length < 2 || choices.length > 10 || choices.some(choice => !choice)) { await ctx.reply(`Usage: ${ctx.prefix}poll Question | Option A | Option B`); return; }
    await ctx.channel.createPoll({ question, choices, time: 60000 });
  } };
