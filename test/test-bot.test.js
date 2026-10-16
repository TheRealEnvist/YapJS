'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Events, MemorySessionStore } = require('@therealenvist/yapjs');
const { createTestBot, startTestBot } = require('../examples/test-bot/bot');
const { createMockAPI } = require('../examples/test-bot/mock-api');
const { runDemo } = require('../examples/test-bot/demo');

const quiet = { log() {}, warn() {}, error() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
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

test('test bot marks itself online at login, renews every 45 seconds, and stops on shutdown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { api, client } = await setup(t);
  const heartbeats = () => api.calls.filter(call => call.url.pathname.endsWith('/heartbeat'));
  assert.equal(client.presence.enabled, true);
  assert.equal(client.presence.status, 'online');
  assert.deepEqual(heartbeats().map(call => call.body), [{ st: 'online', act: null }]);
  t.mock.timers.tick(44999); await tick();
  assert.equal(heartbeats().length, 1);
  t.mock.timers.tick(1); await tick();
  assert.equal(heartbeats().length, 2);
  t.mock.timers.tick(45000); await tick();
  assert.equal(heartbeats().length, 3);
  assert.ok(heartbeats().every(call => call.body.st === 'online'));
  client.destroy();
  t.mock.timers.tick(90000); await tick();
  assert.equal(heartbeats().length, 3);
  assert.equal(client.presence.enabled, false);
});

test('live startup honors configured presence status and activity', async t => {
  const api = createMockAPI(), store = new MemorySessionStore();
  await store.save(api.session);
  const client = await startTestBot({
    env: { YAPPER_STATUS: 'idle', YAPPER_ACTIVITY: 'Testing commands' },
    sessionStore: store, apiKey: 'fake-test-key', fetch: api.fetch, realtime: false, autoRefresh: false, logger: quiet,
  });
  t.after(() => client.destroy());
  const heartbeat = api.calls.find(call => call.url.pathname.endsWith('/heartbeat'));
  assert.equal(heartbeat.body.st, 'idle');
  assert.equal(heartbeat.body.act.name, 'Testing commands');
  assert.equal(client.presence.enabled, true);
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
  assert.match(result.content, /Send: OK\nEdit: OK\nReaction: OK/);
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
  assert.equal(await handle('!test'), true);
  await tick();
  const replies = [...api.messages.values()].map(row => row.content).join('\n');
  assert.match(replies, /Reaction: failed \(Yapper API 403 \(42501\)\)/);
  assert.doesNotMatch(replies, /Reaction: OK|private-api-detail/);
  assert.doesNotMatch(errors.join('\n'), /private-api-detail/);
});

test('avatar and userinfo fetch public profile columns and use the media CDN', async t => {
  const { api, client, handle } = await setup(t);
  assert.equal(await handle('!avatar'), true);
  assert.equal([...api.messages.values()].at(-1).content, `${client.options.mediaBaseUrl}/avatars/demo-user/avatar.png`);
  assert.equal(await handle('!userinfo'), true);
  assert.match([...api.messages.values()].at(-1).content, /Demo Tester\nID: demo-user\nTesting YapJS/);
  const profiles = await client.users.fetch(undefined, { force: true });
  assert.equal(profiles.get('demo-user').bio, 'Testing YapJS');
  await client.user.setBio('Updated test bio');
  assert.equal(client.user.bio, 'Updated test bio');
  assert.ok(api.calls.filter(call => call.url.pathname.endsWith('/profiles')).every(call => !call.url.searchParams.get('select').includes('*')));
});

test('avatar command handles a missing profile image', async t => {
  const { api, handle } = await setup(t);
  api.profiles.find(profile => profile.id === 'demo-user').avatar_path = null;
  assert.equal(await handle('!avatar'), true);
  assert.equal([...api.messages.values()].at(-1).content, 'No profile image is set.');
});

test('avatar URL helpers encode paths and allow a custom media host', t => {
  const client = createTestBot({ apiKey: 'fake-test-key', realtime: false, mediaBaseUrl: 'https://media.example.test/' });
  t.after(() => client.destroy());
  const user = client.users._add({ id: 'avatar-user', avatar_path: 'avatar-user/my photo.png' });
  assert.equal(user.displayAvatarURL(), 'https://media.example.test/avatars/avatar-user/my%20photo.png');
  user._patch({ avatar_path: '/assets/default-avatar.png' });
  assert.equal(user.displayAvatarURL(), 'https://www.yapper.website/assets/default-avatar.png');
});

test('test command reports the live edit denial while still checking reactions', async t => {
  const errors = [];
  const { api, handle } = await setup(t, { onRequest(call) {
    if (call.method === 'PATCH') return Response.json({ code: '42501', message: 'permission denied for table profiles: private-detail' }, { status: 403 });
  } }, { logger: { ...quiet, error: value => errors.push(value) } });
  assert.equal(await handle('!test'), true);
  assert.equal([...api.messages.values()][0].content, 'Testing message send...');
  assert.equal(api.reactions.size, 1);
  const summary = [...api.messages.values()].at(-1).content;
  assert.match(summary, /Send: OK\nEdit: failed \(Yapper API 403 \(42501\)\)\nReaction: OK/);
  assert.doesNotMatch(summary + errors.join('\n'), /private-detail/);
});

test('pages navigate by editing one message with the original audience and controls', async t => {
  const { api, client, handle } = await setup(t);
  assert.equal(await handle('!pages'), true);
  const original = [...api.messages.values()][0];
  api.react(client, original, '\u27a1\ufe0f', 'someone-else'); await tick();
  assert.equal(api.messages.size, 1);
  assert.equal(api.calls.filter(call => call.method === 'PATCH').length, 0);
  const next = api.react(client, original, '\u27a1\ufe0f'); await tick();
  assert.match(api.messages.get(original.id).content, /Second page:[\s\S]*Page 2\/3/);
  api.unreact(client, next); api.react(client, original, '\u27a1\ufe0f'); await tick();
  assert.match(api.messages.get(original.id).content, /Third page:[\s\S]*Page 3\/3/);
  api.react(client, original, '\u2b05\ufe0f'); await tick();
  assert.match(api.messages.get(original.id).content, /Second page:[\s\S]*Page 2\/3/);
  assert.equal(api.messages.size, 1);
  assert.equal(api.calls.filter(call => call.method === 'PATCH').length, 3);
  api.react(client, original, '\u23f9\ufe0f'); await tick();
  assert.equal(client._collectorHub.active.size, 0);
  const count = api.calls.length;
  api.react(client, original, '\u27a1\ufe0f'); await tick();
  assert.equal(api.calls.length, count);
});

test('pages stop after an edit denial without sending more messages', async t => {
  const errors = [];
  const { api, client, handle } = await setup(t, { onRequest(call) {
    if (call.method === 'PATCH') return Response.json({ code: '42501', message: 'permission denied for table profiles' }, { status: 403 });
  } });
  client.on(Events.Error, error => errors.push(error));
  assert.equal(await handle('!pages'), true);
  const original = [...api.messages.values()][0], content = original.content;
  api.react(client, original, '\u27a1\ufe0f'); await tick();
  assert.equal(api.messages.size, 1);
  assert.equal(api.messages.get(original.id).content, content);
  assert.equal(client._collectorHub.active.size, 0);
  assert.equal(errors[0].request.status, 403);
  assert.equal(errors[0].request.code, '42501');
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.url.pathname.endsWith('/messages')).length, 1);
  const count = api.calls.length;
  api.react(client, original, '\u27a1\ufe0f'); await tick();
  assert.equal(api.calls.length, count);
});

test('pagination stops on network failure instead of posting duplicate pages', async t => {
  const errors = [];
  const { api, client, handle } = await setup(t, { onRequest(call) {
    if (call.method === 'PATCH') throw new Error('private-network-detail');
  } });
  client.on(Events.Error, error => errors.push(error));
  assert.equal(await handle('!pages'), true);
  api.react(client, [...api.messages.values()][0], '\u27a1\ufe0f'); await tick();
  assert.equal(api.messages.size, 1);
  assert.equal(client._collectorHub.active.size, 0);
  assert.equal(errors[0].request.code, 'NETWORK_ERROR');
  assert.equal(errors[0].request.method, 'PATCH');
  assert.equal(errors[0].request.route, '/rest/v1/messages');
  assert.doesNotMatch(JSON.stringify(errors), /private-network-detail/);
});

test('command errors retain safe HTTP diagnostics for profile and help failures', async t => {
  const errors = [];
  const { api, client, handle } = await setup(t, { onRequest(call) {
    if (call.url.pathname.endsWith('/profiles') || call.method === 'POST' && call.url.pathname.endsWith('/messages') && call.body.content.includes('List available commands')) {
      return Response.json({ code: '42501', message: 'private-api-detail' }, { status: 403 });
    }
  } }, { logger: { ...quiet, error: value => errors.push(value) } });
  let failure;
  client.on(Events.CommandError, error => { failure = error; });
  assert.equal(await handle('!userinfo'), false); await tick();
  assert.equal(failure.code, 'COMMAND_FAILED');
  assert.deepEqual(failure.request, { status: 403, method: 'GET', route: '/rest/v1/profiles', code: '42501', retryAfter: null });
  assert.match([...api.messages.values()].at(-1).content, /That command failed/);
  assert.equal(await handle('!help'), false); await tick();
  assert.equal(failure.request.route, '/rest/v1/messages');
  assert.match(errors.join('\n'), /403[\s\S]*GET \/rest\/v1\/profiles[\s\S]*42501/);
  assert.doesNotMatch(errors.join('\n') + JSON.stringify(failure), /private-api-detail/);
});

test('sample polls post results without relying on content edits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { api, client, handle } = await setup(t, { onRequest(call) {
    if (call.method === 'PATCH') return Response.json({ code: '42501' }, { status: 403 });
  } });
  const pending = handle('!poll Best snack? | Pizza | Tacos'); await tick();
  api.react(client, [...api.messages.values()][0], '1\ufe0f\u20e3'); await tick();
  t.mock.timers.tick(60000);
  assert.equal(await pending, true);
  assert.match([...api.messages.values()].at(-1).content, /Pizza: 1[\s\S]*Tacos: 0[\s\S]*Poll closed/);
  assert.equal(api.calls.filter(call => call.method === 'PATCH').length, 0);
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
