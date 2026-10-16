'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client, Events, Collection, FileSessionStore, EncryptedFileSessionStore, SessionStorageError, YapperAPIError, decodeYapperValue } = require('../YapperJS');
const publicKey = 'fake-public-key';
const session = (suffix = 'old', expired = false) => ({ access_token: `fake-access-${suffix}`, refresh_token: `fake-refresh-${suffix}`, expires_at: Math.floor(Date.now() / 1000) + (expired ? -10 : 3600), user: { id: 'self', user_metadata: { username: 'tester' } } });
const bootstrap = { profiles: [{ id: 'self', username: 'tester' }, { id: 'other', username: 'friend' }], servers: [{ id: 'guild', name: 'Test' }], channels: [{ id: 'channel', name: 'general', kind: 'text', server_id: 'guild' }], dm_channels: [{ id: 'dm', kind: 'dm' }], members: { guild: [['self', 0]] } };
function setup(handler = () => undefined, extra = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    const call = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
    const custom = await handler(call, calls); if (custom !== undefined) return custom;
    if (call.url.pathname === '/auth/v1/user') return Response.json(session().user);
    if (call.url.pathname === '/auth/v1/token') return Response.json(session('new'));
    if (call.url.pathname === '/rest/v1/rpc/bootstrap') return Response.json(bootstrap);
    return Response.json([]);
  };
  return { client: new Client({ apiKey: publicKey, fetch, realtime: false, autoRefresh: false, ...extra }), calls };
}
const tick = () => new Promise(done => setImmediate(done));

test('Collection transforms', () => {
  const values = new Collection([['a', 1], ['b', 2], ['c', 3]]);
  assert.equal(values.first(), 1); assert.equal(values.last(), 3); assert.equal(values.find(n => n > 1), 2);
  assert.deepEqual([...values.filter(n => n % 2).keys()], ['a', 'c']); assert.deepEqual(values.map(n => n * 2), [2, 4, 6]);
  assert.equal(values.reduce((a, b) => a + b, 0), 6); assert.equal(values.clone().size, 3);
});
test('decode matches deployed adapter and rejects malformed values', () => {
  const input = session(), raw = JSON.stringify(input), key = 'yapper·v1'; let encoded = '';
  for (let i = 0; i < raw.length; i++) encoded += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  assert.deepEqual(decodeYapperValue(Buffer.from(encoded).toString('base64').split('').reverse().join('')), input);
  assert.throws(() => decodeYapperValue('bad'), /Invalid encoded/);
});
test('login hydrates models, aliases and ready events without serializing secrets', async () => {
  const { client } = setup(); let ready = 0; client.once(Events.ClientReady, value => { assert.equal(value, client); ready++; });
  await client.login(session()); assert.equal(ready, 1); assert.equal(client.user.username, 'tester'); assert.equal(client.isReady(), true);
  assert.equal(client.channels.cache.get('channel').guild, client.guilds.cache.get('guild')); assert.equal(client.servers, client.guilds);
  assert.equal(client.guilds.cache.get('guild').channels.cache.size, 1); assert.equal(client.guilds.cache.get('guild').members.size, 1);
  assert.ok(!JSON.stringify(client).includes('fake-access')); assert.ok(!JSON.stringify(client.auth).includes('fake-refresh'));
  client.destroy(); assert.equal(client.isReady(), false); assert.equal(client.user, null);
});
test('expired login rotates using public key then uses new token for profile', async () => {
  const saved = []; const { client, calls } = setup(undefined, { sessionStore: { load: async () => null, save: async value => saved.push(value) } });
  await client.login(session('old', true)); const refresh = calls.find(call => call.url.pathname.endsWith('/token'));
  assert.deepEqual(refresh.body, { refresh_token: 'fake-refresh-old' }); assert.equal(refresh.options.headers.Authorization, `Bearer ${publicKey}`);
  assert.equal(refresh.options.headers['Content-Type'], 'application/json');
  assert.equal(calls.find(call => call.url.pathname.endsWith('/user')).options.headers.Authorization, 'Bearer fake-access-new');
  assert.equal(saved.at(-1).refresh_token, 'fake-refresh-new'); client.destroy();
});
test('concurrent refresh shares exchange and persists before event', async () => {
  let resolve, exchanges = 0, saved = false, emitted = false;
  const { client } = setup(call => call.url.pathname.endsWith('/token') ? (exchanges++, new Promise(done => { resolve = () => done(Response.json(session('new'))); })) : undefined,
    { sessionStore: { load: async () => null, save: async () => { saved = true; } } });
  await client.login(session()); saved = false;
  client.on(Events.TokenRefresh, metadata => { emitted = true; assert.equal(saved, true); assert.ok(!('refresh_token' in metadata)); });
  const a = client.auth.refresh(), b = client.auth.refresh(); assert.equal(a, b); await tick(); resolve(); await Promise.all([a, b]);
  assert.equal(exchanges, 1); assert.equal(emitted, true); assert.equal(client.refreshtoken, 'fake-refresh-new'); client.destroy();
});
test('storage failure blocks requests and resumes persistence without rerotation', async () => {
  let fail = false, exchanges = 0;
  const { client, calls } = setup(call => call.url.pathname.endsWith('/token') ? (exchanges++, Response.json(session('new'))) : undefined,
    { sessionStore: { load: async () => null, save: async () => { if (fail) throw new Error('fake-secret'); } } });
  await client.login(session()); fail = true; await assert.rejects(client.auth.refresh(), SessionStorageError);
  const before = calls.length; await assert.rejects(client.users.fetch('other', { force: true }), SessionStorageError); assert.equal(calls.length, before);
  fail = false; await client.users.fetch('other', { force: true }); assert.equal(exchanges, 1); client.destroy();
});
test('incomplete rotation leaves original session', async () => {
  const { client } = setup(call => call.url.pathname.endsWith('/token') ? Response.json({ access_token: 'incomplete' }) : undefined);
  await client.login(session()); await assert.rejects(client.auth.refresh(), /incomplete session/); assert.equal(client.token, 'fake-access-old'); client.destroy();
});
test('HTTP errors are checked and response bodies remain private', async () => {
  const { client } = setup(call => call.url.pathname === '/rest/v1/profiles' ? Response.json({ message: 'fake-refresh-secret', code: '42501' }, { status: 403 }) : undefined);
  await client.login(session()); await assert.rejects(client.users.fetch('unknown'), error => error instanceof YapperAPIError && error.status === 403 && error.code === '42501' && !JSON.stringify(error).includes('fake-refresh-secret')); client.destroy();
});
test('GET retries once on 401 using rotated token', async () => {
  let attempts = 0;
  const { client, calls } = setup(call => call.url.pathname === '/rest/v1/profiles' ? (++attempts === 1 ? Response.json({}, { status: 401 }) : Response.json([{ id: 'unknown', username: 'found' }])) : undefined);
  await client.login(session()); assert.equal((await client.users.fetch('unknown')).username, 'found'); assert.equal(attempts, 2);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/token')).length, 1); client.destroy();
});
test('message sends are never automatically replayed', async () => {
  const { client, calls } = setup(call => call.url.pathname === '/rest/v1/messages' ? Response.json({}, { status: 401 }) : undefined);
  await client.login(session()); await assert.rejects(client.channels.cache.get('channel').send('hello'), YapperAPIError);
  assert.equal(calls.filter(call => call.url.pathname === '/rest/v1/messages').length, 1); client.destroy();
});
test('send, reply, edit and delete use verified message fields', async () => {
  let n = 0;
  const { client, calls } = setup(call => {
    if (call.url.pathname === '/rest/v1/messages') {
      if (call.options.method === 'POST') return Response.json([{ ...call.body, created_at: new Date().toISOString(), edited_at: null, id: `message-${++n}` }]);
      if (call.options.method === 'PATCH') return Response.json([{ id: 'message-1', channel_id: 'channel', author_id: 'self', content: call.body.content }]);
      if (call.options.method === 'DELETE') return Response.json([{ id: 'message-1' }]);
    }
  });
  await client.login(session()); const channel = client.channels.cache.get('channel'), message = await channel.send('hello');
  assert.equal(message.author, client.user); assert.equal(message.guild.id, 'guild'); await message.reply('reply');
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/messages'))[1].body.reply_to_id, message.id);
  assert.equal((await message.edit('updated')).content, 'updated'); await message.delete(); assert.equal(channel.messages.cache.has(message.id), false);
  await assert.rejects(channel.send({ content: 'hello', embeds: [] }), /Unsupported message option/); client.destroy();
});
test('message history constrains channel and bounds cache', async () => {
  const { client, calls } = setup(call => call.url.pathname.endsWith('/messages') ? Response.json([{ id: 'm1', channel_id: 'channel', content: '1' }, { id: 'm2', channel_id: 'channel', content: '2' }]) : undefined, { messageCacheMaxSize: 1 });
  await client.login(session()); const manager = client.channels.cache.get('channel').messages;
  assert.equal((await manager.fetch({ limit: 2 })).size, 2); assert.equal(manager.cache.size, 1); assert.equal(calls.at(-1).url.searchParams.get('channel_id'), 'eq.channel');
  await assert.rejects(manager.fetch({ limit: 500 }), RangeError); client.destroy();
});
test('events deduplicate messages and snapshot updates', async () => {
  const { client } = setup(); await client.login(session()); const received = []; client.on(Events.MessageCreate, message => received.push(message.id));
  const payload = { table: 'messages', operation: 'INSERT', record: { id: 'm', channel_id: 'channel', author_id: 'other', content: 'before' } };
  client._dispatch('message', payload); client._dispatch('message', payload); assert.deepEqual(received, ['m']);
  let oldContent, newContent; client.once(Events.MessageUpdate, (before, after) => { oldContent = before.content; newContent = after.content; });
  client._dispatch('message', { table: 'messages', operation: 'UPDATE', record: { id: 'm', channel_id: 'channel', content: 'after' } });
  assert.equal(oldContent, 'before'); assert.equal(newContent, 'after');
  client._dispatch('message', { table: 'messages', operation: 'DELETE', old_record: { id: 'm', channel_id: 'channel' } });
  assert.equal(client.channels.cache.get('channel').messages.cache.has('m'), false); client.destroy();
});
test('async event rejection avoids unhandled rejection and secret disclosure', async () => {
  const { client } = setup(); let warning; client.on(Events.Warn, value => { warning = value; });
  client.on('example', async () => { throw new Error('fake-secret'); }); client.emit('example'); await tick();
  assert.match(warning, /listener rejected/); assert.ok(!warning.includes('fake-secret')); client.destroy();
});
test('destroy during refresh cannot resurrect session', async () => {
  let resolve; const { client } = setup(call => call.url.pathname.endsWith('/token') ? new Promise(done => { resolve = () => done(Response.json(session('new'))); }) : undefined);
  await client.login(session()); const refreshing = client.auth.refresh(); await tick(); client.destroy(); resolve();
  await assert.rejects(refreshing, /cancelled/); assert.equal(client.token, null); assert.equal(client.isReady(), false);
});
test('file session replacement round-trips and uses private POSIX permissions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yapjs-test-'));
  try {
    const store = new FileSessionStore(path.join(directory, 'session.json')), value = session();
    await store.save(value); assert.deepEqual(await store.load(), value);
    // Windows stat mode bits do not represent NTFS access control lists.
    if (process.platform !== 'win32') assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    await store.clear(); assert.equal(await store.load(), null);
  }
  finally { await rm(directory, { recursive: true, force: true }); }
});
test('encrypted store hides tokens and rejects wrong keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yapjs-test-'));
  try { const store = new EncryptedFileSessionStore(path.join(directory, 'session.enc.json'), Buffer.alloc(32, 3)), value = session(); await store.save(value); assert.deepEqual(await store.load(), value);
    const text = await readFile(store.path, 'utf8'); assert.ok(!text.includes('fake-refresh')); assert.ok(!text.includes('fake-access'));
    await assert.rejects(new EncryptedFileSessionStore(store.path, Buffer.alloc(32, 4)).load(), SessionStorageError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('login restores saved sessions without embedded credentials', async () => {
  const { client } = setup(undefined, { sessionStore: { load: async () => session(), save: async () => {} } });
  await client.login(); assert.equal(client.isReady(), true); client.destroy();
});
test('login can retry after failure', async () => {
  let fail = true; const { client } = setup(call => call.url.pathname === '/auth/v1/user' && fail ? Response.json({}, { status: 403 }) : undefined);
  await assert.rejects(client.login(session()), YapperAPIError); assert.equal(client.isReady(), false); fail = false;
  await client.login(session()); assert.equal(client.isReady(), true); client.destroy();
});
class FakeWebSocket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; FakeWebSocket.instances.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
  send(raw) { const data = JSON.parse(raw); this.sent.push(data); if (data.type === 'auth') queueMicrotask(() => this.receive({ type: 'auth', ok: true })); if (data.type === 'subscribe') queueMicrotask(() => this.receive({ type: 'subscribed', ok: data.topics })); }
  receive(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close() { this.readyState = 3; this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 })); }
}
test('gateway authenticates, subscribes, dispatches and reconnects with rotated token', async () => {
  FakeWebSocket.instances = []; const { client } = setup(undefined, { realtime: true, WebSocket: FakeWebSocket });
  await client.login(session()); assert.equal(client.gateway.connected, true);
  const socket = FakeWebSocket.instances[0]; assert.equal(socket.url, 'wss://rt.yapper.website/ws'); assert.equal(socket.sent[0].token, 'fake-access-old');
  const topics = socket.sent.find(data => data.type === 'subscribe').topics; assert.ok(topics.includes('user:self')); assert.ok(topics.includes('server:guild')); assert.ok(topics.includes('chan:channel'));
  let received; client.once(Events.MessageCreate, message => { received = message.content; }); socket.receive({ type: 'event', event: 'message', payload: { table: 'messages', operation: 'INSERT', record: { id: 'live', channel_id: 'channel', content: 'hello' } } }); assert.equal(received, 'hello');
  await client.auth.refresh(); await tick(); assert.equal(FakeWebSocket.instances.length, 2); assert.equal(FakeWebSocket.instances[1].sent[0].token, 'fake-access-new'); client.destroy(); assert.equal(client.gateway.connected, false);
});
