'use strict';
const { createTestBot } = require('./bot');
const { createMockAPI } = require('./mock-api');

async function runDemo(logger = console) {
  const api = createMockAPI({ onRequest(call) {
    if (call.url.pathname === '/rest/v1/messages' && call.method === 'POST') {
      logger.log(`[${call.body.channel_id === 'demo-dm' ? 'DM' : '#bot-testing'}] ${call.body.content}`);
    } else if (call.method === 'PATCH') logger.log(`[edit] ${call.body.content}`);
    else if (call.url.pathname === '/rest/v1/reactions') logger.log(`[reaction] ${call.body.emoji}`);
  } });
  const client = createTestBot({ apiKey: 'fake-demo-key', fetch: api.fetch, realtime: false, autoRefresh: false, logger });
  try {
    logger.log('Offline demo: fake account, in-memory API, no network or session files.');
    await client.login(api.session);
    for (const content of ['!ping', '!echo Hello from YapJS!', '!avatar', '!userinfo', '!status', '!test', '!dm Hello privately!', '!help']) {
      logger.log(`\nTester: ${content}`);
      if (!await client.commands.handle(api.incoming(client, content))) throw new Error(`Demo command failed: ${content}`);
    }
    logger.log('\nOffline demo passed. Run npm run bot with your session to connect to Yapper.');
  } finally { client.destroy(); }
}

if (require.main === module) runDemo().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { runDemo };
