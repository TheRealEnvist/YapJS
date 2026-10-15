'use strict';
module.exports = { name: 'ask', description: 'Try a message collector', cooldown: 35000,
  async execute(ctx) {
    // Start listening before posting the prompt so a quick reply cannot be missed.
    const replies = ctx.awaitReply({ time: 30000 });
    await ctx.reply('Send a reply in this channel within 30 seconds.');
    const collected = await replies; const answer = collected.first();
    if (ctx.client.isReady()) await ctx.reply(answer ? `You said: ${answer.content}` : 'No reply received.');
  } };
