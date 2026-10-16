'use strict';
const path = require('node:path');
// Node's built-in loader reads local configuration without another dependency.
try { process.loadEnvFile(path.join(__dirname, '../../.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const { Client, Events, FileSessionStore, EncryptedFileSessionStore } = require('yapjs');
const config = require('./config');
const registerEvents = require('./events');

const key = process.env.YAPPER_SESSION_KEY;
const sessionStore = key
  ? new EncryptedFileSessionStore(path.join(__dirname, '../../YapperJS/session.enc.json'), key)
  : new FileSessionStore(path.join(__dirname, '../../YapperJS/session.json'));

const client = new Client({
  apiKey: process.env.YAPPER_API_KEY,
  sessionStore,
  presence: config.presence,
  commands: config.commands,
});

registerEvents(client, config.events);

client.once(Events.ClientReady, readyClient => {
  console.log(`Ready as ${readyClient.user.username}. Connected to ${readyClient.guilds.cache.size} servers.`);
});
client.on(Events.Error, error => console.error(error.message));
client.on(Events.Warn, warning => console.warn(warning));
client.on(Events.TokenRefresh, () => console.log('Session refreshed and saved.'));
client.on(Events.RefreshRetry, info => console.warn(`Session refresh will retry in ${Math.ceil(info.retryIn / 1000)}s.`));
client.on(Events.SessionInvalidated, () => console.error('Session rejected by Yapper. Initialize a new independent login session.'));

client.on(Events.CommandError, error => console.error(error.message));
if (config.commands.enabled) {
  client.commands.load(path.join(__dirname, 'commands')).addHelpCommand();
  require('./moderation')(client);
}

function shutdown() { client.destroy(); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

// Restores session.json by default. Supply YAPPER_SESSION JSON or YAPPER_VALUE
// only to initialize a separate session; never commit either value to source.
async function main() {
  const saved = await sessionStore.load();
  await client.login(saved ?? (process.env.YAPPER_SESSION || process.env.YAPPER_VALUE || undefined));
  const profile = Object.fromEntries(Object.entries(config.profile).filter(([, value]) => value !== undefined));
  if (Object.keys(profile).length) await client.user.edit(profile);
}

main().catch(error => {
  console.error(error.message); client.destroy(); process.exitCode = 1;
});
