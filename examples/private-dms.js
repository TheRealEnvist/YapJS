'use strict';
// Run explicitly from your own project after installing @therealenvist/yapjs.
const path = require('node:path');
const { Client, Events, FileSessionStore } = require('@therealenvist/yapjs');
const sessionStore = new FileSessionStore(path.resolve('.data/yapper-session.json'));
const client = new Client({ sessionStore });
client.on(Events.MessageCreate, async message => {
  if (!message.channel?.isDMBased() || message.authorId === client.userId) return;
  if (message.content === '!ping') await message.reply('Pong, privately!');
});
client.on(Events.Warn, warning => console.warn(warning));
client.on(Events.SessionInvalidated, () => console.error('Please initialize a new authorized session.'));
async function main() { const saved = await sessionStore.load(); await client.login(saved ?? (process.env.YAPPER_SESSION || undefined)); }
main().catch(error => { console.error(error.message); client.destroy(); process.exitCode = 1; });
process.once('SIGINT', () => client.destroy());
process.once('SIGTERM', () => client.destroy());
