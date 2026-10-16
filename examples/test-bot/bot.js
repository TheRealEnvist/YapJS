'use strict';
const path = require('node:path');
const { Client, Events, FileSessionStore, EncryptedFileSessionStore, YapperAPIError } = require('@therealenvist/yapjs');

const root = path.resolve(__dirname, '../..');

// Importing this file does not load .env or connect. Pass Client options to test
// the same commands with a mock fetch implementation, or add your own commands.
function createTestBot({ logger = console, ...options } = {}) {
  const client = new Client({
    presence: { status: 'online' },
    ...options,
    commands: { prefix: '!', cooldown: 1000, replyOnReject: true, ...options.commands },
  });

  client.commands.load(path.join(__dirname, '../bot/commands'));
  client.commands.register({
    name: 'echo', description: 'Reply with your text', usage: '<text>', minArgs: 1,
    async execute(ctx) { await ctx.reply(ctx.rawArgs); },
  });
  client.commands.register({
    name: 'status', description: 'Show the bot connection and cache counts',
    async execute(ctx) {
      await ctx.reply([
        `Online as ${ctx.client.user.username || ctx.client.userId}`,
        `Uptime: ${Math.floor(ctx.client.uptime / 1000)}s`,
        `Servers: ${ctx.client.guilds.cache.size}`,
        `Channels cached: ${ctx.client.channels.cache.size}`,
        `Here: ${ctx.guild?.name || (ctx.guild ? ctx.guild.id : 'Direct message')}`,
      ].join('\n'));
    },
  });
  client.commands.register({
    name: 'test', description: 'Test sending, editing, and reacting to a bot message', cooldown: 10000,
    async execute(ctx) {
      const message = await ctx.reply('Testing message send...');
      const results = ['Send: OK'];
      async function check(label, action) {
        try { await action(); results.push(`${label}: OK`); }
        catch (error) {
          const detail = error instanceof YapperAPIError ? `Yapper API ${error.status || 'network'} (${error.code})` : 'see the bot console';
          const request = error instanceof YapperAPIError ? ` ${error.method} ${error.route}` : '';
          logger.error(`Test ${label.toLowerCase()} failed: ${detail}${request}`);
          results.push(`${label}: failed (${detail})`);
        }
      }
      await check('Edit', () => message.edit('Message send and edit: OK'));
      await check('Reaction', () => message.react('\u2705'));
      await ctx.reply(`${results.join('\n')}\nTry ${ctx.prefix}dm to test private messages.`);
    },
  });
  client.commands.register({
    name: 'dm', description: 'Send a test DM to yourself', usage: '[text]', cooldown: 10000,
    async execute(ctx) {
      try {
        // Only the person invoking the command is a recipient.
        await ctx.client.sendDM(ctx.authorId, ctx.rawArgs || `Private messages work! Try ${ctx.prefix}ping here.`);
      } catch {
        await ctx.reply('Could not send you a DM. Check your DM settings and the bot account permissions.');
        return;
      }
      if (!ctx.channel?.isDMBased()) await ctx.reply('Sent you a DM.');
    },
  });
  client.commands.addHelpCommand();

  client.once(Events.ClientReady, ready => {
    logger.log(`Ready as ${ready.user.username || ready.userId}. Type ${ready.commands.prefix}help in a server channel or DM.`);
  });
  client.on(Events.Error, error => logger.error(error.message));
  client.on(Events.Warn, warning => logger.warn(warning));
  client.on(Events.TokenRefresh, () => logger.log('Session refreshed and saved.'));
  client.on(Events.RefreshRetry, info => logger.warn(`Session refresh retry in ${Math.ceil(info.retryIn / 1000)}s.`));
  client.on(Events.SessionInvalidated, () => logger.error('Session rejected. Initialize a new authorized session and restart the bot.'));
  client.on(Events.GatewayDisconnect, () => logger.warn('Realtime disconnected. Waiting to reconnect.'));
  client.on(Events.GatewayReconnect, () => logger.log('Reconnecting realtime.'));
  client.on(Events.CommandError, async (error, ctx) => {
    logger.error(`${ctx.command?.name || 'Command'}: ${error.message}`);
    const content = error.code === 'COMMAND_PARSE_ERROR'
      ? 'Could not parse that command. Check that your quotes are closed.'
      : 'That command failed. Check the bot console and account permissions.';
    if (client.isReady()) await ctx.message.reply(content).catch(() => {});
  });
  return client;
}

async function startTestBot({ env = process.env, ...options } = {}) {
  const key = env.YAPPER_SESSION_KEY;
  const filename = env.YAPPER_SESSION_FILE || (key ? 'YapperJS/session.enc.json' : 'YapperJS/session.json');
  const sessionStore = options.sessionStore ?? (key
    ? new EncryptedFileSessionStore(path.resolve(root, filename), key)
    : new FileSessionStore(path.resolve(root, filename)));
  // Prefer the saved replacement pair over stale first-use environment values.
  const saved = await sessionStore.load();
  const session = saved ?? (env.YAPPER_SESSION || env.YAPPER_VALUE || undefined);
  if (!session) {
    throw new Error('No Yapper session found. Set YAPPER_SESSION or YAPPER_VALUE in .env, or set YAPPER_SESSION_FILE to your saved session. See examples/test-bot/README.md.');
  }
  const client = createTestBot({
    apiKey: env.YAPPER_API_KEY || undefined,
    commands: { prefix: env.YAPPER_PREFIX || '!' },
    presence: {
      status: env.YAPPER_STATUS || 'online',
      ...(env.YAPPER_ACTIVITY ? { activity: env.YAPPER_ACTIVITY } : {}),
    },
    ...options,
    sessionStore,
  });
  try { await client.login(session); return client; }
  catch (error) { client.destroy(); throw error; }
}

if (require.main === module) {
  Promise.resolve().then(() => {
    try { process.loadEnvFile(path.join(root, '.env')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return startTestBot();
  }).then(client => {
    process.once('SIGINT', () => client.destroy());
    process.once('SIGTERM', () => client.destroy());
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createTestBot, startTestBot };
