'use strict';
const { MessageBulkDeleteError } = require('yapperjs');
// Only configured bot owners may use these commands, even when the bot account
// has broad server permissions. The API independently checks its permissions.
module.exports = function registerModeration(client) {
  const target = value => value?.replace(/^<@!?([^>]+)>$/, '$1').replace(/^@/, '');
  const add = (name, usage, minArgs, execute, maxArgs) => client.commands.register({ name, description: 'Server moderation (bot owners)', usage, guildOnly: true, ownerOnly: true, minArgs, maxArgs, execute });
  add('kick', '<userId>', 1, async ctx => { await ctx.guild.members.kick(target(ctx.args[0])); await ctx.send('Member kicked.'); }, 1);
  add('ban', '<userId>', 1, async ctx => { await ctx.guild.bans.create(target(ctx.args[0])); await ctx.send('Member banned.'); }, 1);
  add('unban', '<userId>', 1, async ctx => { await ctx.guild.bans.remove(target(ctx.args[0])); await ctx.send('Ban removed.'); }, 1);
  add('timeout', '<userId> <minutes> [reason]', 2, async ctx => {
    const minutes = Number(ctx.args[1]); if (!Number.isSafeInteger(minutes) || minutes < 1) return ctx.send('Use a positive whole number of minutes.');
    await ctx.guild.members.timeout(target(ctx.args[0]), minutes * 60000, ctx.args.slice(2).join(' ')); await ctx.send('Member timed out.');
  });
  add('nick', '<userId> [nickname; omit to clear]', 1, async ctx => { await ctx.guild.members.setNickname(target(ctx.args[0]), ctx.args.slice(1).join(' ') || null); await ctx.send('Nickname updated.'); });
  add('deletemessage', '<messageId>', 1, async ctx => { await ctx.channel.messages.delete(ctx.args[0]); await ctx.send('Message deleted.'); }, 1);
  add('purge', '<count: 1-100>', 1, async ctx => {
    const count = Number(ctx.args[0]); if (!Number.isInteger(count) || count < 1 || count > 100) return ctx.send('Choose between 1 and 100 messages.');
    try { const deleted = await ctx.channel.bulkDelete(count); await ctx.send(`Deleted ${deleted.size} messages.`); }
    catch (error) { if (!(error instanceof MessageBulkDeleteError)) throw error; await ctx.send(`Stopped after deleting ${error.deleted.size} messages. The next deletion failed.`); }
  }, 1);
  add('role', 'create <name> [#color] | edit <id> <name> [#color] | delete <id> | add/remove <userId> <roleId> | list', 1, async ctx => {
    const [action, first, second, third] = ctx.args;
    if (action === 'list' && ctx.args.length === 1) {
      const roles = await ctx.guild.roles.fetch();
      if (!roles.size) return ctx.send('No roles.');
      let page = '';
      for (const role of roles.values()) { const line = `${role.id}: ${role.name ?? '(unnamed)'}`; if (page && page.length + line.length + 1 > 1800) { await ctx.send(page); page = ''; } page += `${page ? '\n' : ''}${line}`; }
      if (page) await ctx.send(page); return;
    }
    if (action === 'create' && first && ctx.args.length <= 3) {
      const role = await ctx.guild.roles.create({ name: first, ...(second ? { color: second } : {}) }); return ctx.send(`Created role ${role.name} (${role.id}).`);
    }
    if (action === 'edit' && first && second && ctx.args.length <= 4) {
      const role = await ctx.guild.roles.edit(first, { name: second, ...(third ? { color: third } : {}) }); return ctx.send(`Updated role ${role.name}.`);
    }
    if (action === 'delete' && first && ctx.args.length === 2) { await ctx.guild.roles.delete(first); return ctx.send('Role deleted.'); }
    if (['add', 'remove'].includes(action) && first && second && ctx.args.length === 3) {
      const member = await ctx.guild.members.fetch(target(first)); if (!member) return ctx.send('Member unavailable in this server.');
      await member.roles[action](second); return ctx.send(action === 'add' ? 'Role assigned.' : 'Role removed.');
    }
    return ctx.send(`Usage: ${ctx.prefix}role ${ctx.command.usage}. Quote names containing spaces.`);
  });
  return client.commands;
};
