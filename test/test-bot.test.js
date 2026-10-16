'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Events, MemorySessionStore } = require('yapperjs');
const { createTestBot, startTestBot } = require('../examples/test-bot/bot');
const { createMockAPI } = require('../examples/test-bot/mock-api');
const { runDemo } = require('../examples/test-bot/demo');

const quiet = { log() {}, warn() {}, error() {} };
async function setup(t, mockOptions, clientOptions) {
  const api = createMockAPI(mockOptions);
  const client = createTestBot({ apiKey: 'fake-test-key', fetch: api.fetch, realtime: false, autoRefresh: false, logger: quiet, ...clientOptions });
  t.after(() => client.destroy());
  await client.login(api.session);
  return { api, client, handle: (content, options) => client.commands.handle(api.incoming(client, content, options)) };
}

test('blank optional API key from .env uses the bundled public key', t => {
  const previous = process.env.YAPPER_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.YAPPER_API_KEY;
    else process.env.YAPPER_API_KEY = previous;
  });
  process.env.YAPPER_API_KEY = '';
  const client = createTestBot({ realtime: false, logger: quiet });
  t.after(() => client.destroy());
  assert.equal(client.apiKey, require('../YapperJS/global').apiKey);
});

test('test bot handles real incoming events and ignores its own messages', async t => {
  const { api, client, handle } = await setup(t);
  const finished = once(client, Events.CommandFinish);
  const message = api.incoming(client, '!ping');
  client.emit(Events.MessageCreate, message);
  await finished;
  assert.equal([...api.messages.values()][0].content, 'Pong!');
  assert.equal([...api.messages.values()][0].reply_to_id, message.id);
  const count = api.calls.length;
  assert.equal(await handle('!echo loop', { authorId: client.userId }), false);
  assert.equal(api.calls.length, count);
  assert.equal(client.commands.resolve('ban'), null);
});

test('test bot supports a custom prefix, echo, usage feedback, status and help', async t => {
  const { api, handle } = await setup(t, undefined, { commands: { prefix: '?' } });
  assert.equal(await handle('!ping'), false);
  assert.equal(await handle('?echo'), false);
  assert.match([...api.messages.values()].at(-1).content, /Usage: \?echo <text>/);
  assert.equal(await handle('?echo Hello world'), true);
  assert.equal([...api.messages.values()].at(-1).content, 'Hello world');
  assert.equal(await handle('?status'), true);
  assert.match([...api.messages.values()].at(-1).content, /Online as TestBot[\s\S]*Servers: 1[\s\S]*Test Server/);
  assert.equal(await handle('?help'), true);
  const help = [...api.messages.values()].at(-1).content;
  for (const command of ['?test', '?dm', '?echo', '?menu', '?poll']) assert.ok(help.includes(command));
});

test('test command edits only its new reply and seeds a reaction', async t => {
  const { api, handle } = await setup(t);
  assert.equal(await handle('!test'), true);
  const [edited, result] = [...api.messages.values()];
  const patch = api.calls.find(call => call.method === 'PATCH');
  assert.equal(patch.url.searchParams.get('id'), `eq.${edited.id}`);
  assert.equal(edited.content, 'Message send and edit: OK');
  assert.equal([...api.reactions.values()][0].message_id, edited.id);
  assert.equal([...api.reactions.values()][0].emoji, '\u2705');
  assert.match(result.content, /tests passed/);
});

test('dm command sends only to the invoking user and accepts commands in DMs', async t => {
  const { api, handle } = await setup(t);
  assert.equal(await handle('!dm hello privately'), true);
  assert.deepEqual(api.calls.find(call => call.url.pathname.endsWith('/get_or_create_dm')).body, { other: 'demo-user' });
  assert.equal([...api.messages.values()][0].channel_id, 'demo-dm');
  assert.equal([...api.messages.values()][0].content, 'hello privately');
  assert.equal(await handle('!ping', { channelId: 'demo-dm' }), true);
  assert.equal([...api.messages.values()].at(-1).channel_id, 'demo-dm');
  assert.equal([...api.messages.values()].at(-1).content, 'Pong!');
});

test('DM denials and command failures produce useful replies without private API details', async t => {
  const errors = [];
  const { api, handle } = await setup(t, { onRequest(call) {
    if (call.url.pathname.endsWith('/get_or_create_dm') || call.url.pathname.endsWith('/reactions')) {
      return Response.json({ code: '42501', message: 'private-api-detail' }, { status: 403 });
    }
  } }, { logger: { ...quiet, error: value => errors.push(value) } });
  assert.equal(await handle('!dm'), true);
  assert.match([...api.messages.values()].at(-1).content, /Could not send you a DM/);
  assert.equal(await handle('!test'), false);
  await new Promise(resolve => setImmediate(resolve));
  const replies = [...api.messages.values()].map(row => row.content).join('\n');
  assert.match(replies, /That command failed/);
  assert.doesNotMatch(replies, /tests passed|private-api-detail/);
  assert.doesNotMatch(errors.join('\n'), /private-api-detail/);
});

test('startup prefers persisted tokens and reports missing session before connecting', async t => {
  const api = createMockAPI(), store = new MemorySessionStore();
  await store.save(api.session);
  const client = await startTestBot({
    env: { YAPPER_SESSION: 'stale-invalid-value', YAPPER_PREFIX: '?', YAPPER_API_KEY: '' },
    sessionStore: store, apiKey: 'fake-test-key', fetch: api.fetch, realtime: false, autoRefresh: false, logger: quiet,
  });
  t.after(() => client.destroy());
  assert.equal(client.isReady(), true);
  assert.equal(client.token, api.session.access_token);
  assert.equal(client.commands.prefix, '?');
  await assert.rejects(startTestBot({ env: {}, sessionStore: new MemorySessionStore(), fetch() { assert.fail('Must not connect without a session'); } }), /No Yapper session found/);
});

test('offline demo runs without network, environment loading, files or process handlers', async t => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Must not use the network'); });
  t.mock.method(process, 'loadEnvFile', () => { assert.fail('Must not load .env'); });
  const counts = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  const output = [];
  await runDemo({ ...quiet, log: line => output.push(line) });
  assert.match(output.join('\n'), /Offline demo passed/);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), counts);
});
