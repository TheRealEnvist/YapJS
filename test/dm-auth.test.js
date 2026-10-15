'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Events, MemorySessionStore, SessionStorageError, AuthenticationError } = require('../YapperJS');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const session = (name = 'old', seconds = 3600) => ({ access_token: `fake-access-${name}`, refresh_token: `fake-refresh-${name}`, expires_at: Math.floor(Date.now() / 1000) + seconds, user: { id: 'self' } });
function setup(handler, options = {}) {
  const calls = [];
  const data = { profiles: [{ id: 'self', username: 'Bot' }, { id: 'alice', username: 'Alice' }], servers: [{ id: 'guild' }], channels: [{ id: 'server-channel', server_id: 'guild', kind: 'text' }], dm_channels: [] };
  const fetch = async (url, options) => {
    const call = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
    if (handler) { const response = await handler(call); if (response !== undefined) return response; }
    const route = call.url.pathname;
    if (route.endsWith('/auth/v1/user')) return Response.json(session().user);
    if (route.endsWith('/auth/v1/token')) return Response.json(session('new'));
    if (route.endsWith('/rpc/bootstrap')) return Response.json(data);
    if (route.endsWith('/rpc/get_or_create_dm')) return Response.json('dm-channel');
    if (route.endsWith('/channels')) return Response.json([{ id: 'dm-channel', kind: 'dm', server_id: null }]);
    if (route.endsWith('/channel_members')) return Response.json([{ channel_id: 'dm-channel', user_id: 'self' }, { channel_id: 'dm-channel', user_id: 'alice' }]);
    if (route.endsWith('/messages') && options.method === 'POST') return Response.json([{ ...call.body }]);
    return Response.json([]);
  };
  const client = new Client({ apiKey: 'fake-public', realtime: false, autoRefresh: false, fetch, ...options });
  return { client, calls, data };
}
async function fixture(t, handler, options) { const result = setup(handler, options); await result.client.login(session()); t.after(() => result.client.destroy()); return result; }

test('DM helpers share in-flight creation, cache recipients and send through private channels', async t => {
  const { client, calls } = await fixture(t); const alice = client.users.cache.get('alice');
  const [one, two] = await Promise.all([client.createDM(alice), alice.createDM()]); assert.equal(one, two);
  assert.equal(one.isDMBased(), true); assert.deepEqual(one.memberIds, ['self', 'alice']); assert.equal(alice.dmChannel, one); assert.equal(client.dms.cache.get(one.id), one);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/get_or_create_dm')).length, 1);
  const first = await client.sendDM('alice', 'Private hello'); await client.users.send(alice, 'Another'); await alice.send('Third');
  assert.equal(first.guild, null); assert.equal(first.channel, one); assert.equal(first.authorId, 'self');
  const sends = calls.filter(call => call.url.pathname.endsWith('/messages')); assert.equal(sends.length, 3); assert.ok(sends.every(call => call.body.channel_id === 'dm-channel'));
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/get_or_create_dm')).length, 1);
  await client.createDM('alice', { force: true }); assert.equal(calls.filter(call => call.url.pathname.endsWith('/get_or_create_dm')).length, 2);
});

test('DM creation fails without login, on denial and when RPC returns a server channel', async t => {
  const { client } = setup(); t.after(() => client.destroy()); await assert.rejects(client.sendDM('alice', 'Hello'), AuthenticationError);
  let mode = 'deny'; const { client: loggedIn, calls } = await fixture(t, call => {
    if (call.url.pathname.endsWith('/get_or_create_dm') && mode === 'deny') return Response.json({}, { status: 403 });
    if (call.url.pathname.endsWith('/channels') && mode === 'server') return Response.json([{ id: 'dm-channel', server_id: 'guild', kind: 'text' }]);
  });
  await assert.rejects(loggedIn.sendDM('alice', 'Hello')); mode = 'server'; await assert.rejects(loggedIn.sendDM('alice', 'Hello'), /DM channel/);
  assert.equal(calls.some(call => call.url.pathname.endsWith('/messages')), false); assert.equal(loggedIn.dms.cache.has('dm-channel'), false);
});

test('DM fetches load membership for typing and exclude server channels', async t => {
  const { client, calls } = await fixture(t); const channel = await client.dms.fetch('dm-channel');
  assert.deepEqual(channel.memberIds, ['self', 'alice']); assert.equal(client.dms.resolve('server-channel'), null);
  const query = calls.find(call => call.url.pathname.endsWith('/channel_members')); assert.equal(query.url.searchParams.get('channel_id'), 'eq.dm-channel');
  assert.equal((await client.dms.fetch()).size, 1);
});

test('incoming first-contact DMs hydrate channel metadata and preserve message order before dispatch', async t => {
  let release; const { client, calls } = await fixture(t, call => call.url.pathname.endsWith('/channel_members') ? new Promise(resolve => { release = () => resolve(Response.json([{ channel_id: 'dm-channel', user_id: 'self' }, { channel_id: 'dm-channel', user_id: 'alice' }])); }) : undefined);
  const received = []; let raw = 0; client.on(Events.Raw, () => raw++);
  client.on(Events.MessageCreate, message => { assert.equal(message.channel.isDMBased(), true); assert.equal(message.guild, null); received.push(message.id); });
  const dispatch = id => client._dispatch('message', { table: 'messages', operation: 'INSERT', record: { id, channel_id: 'dm-channel', author_id: 'alice', content: id } });
  dispatch('m1'); await tick(); dispatch('m2'); assert.deepEqual(received, []); release(); await tick();
  assert.deepEqual(received, ['m1', 'm2']); assert.equal(raw, 2); assert.equal(calls.filter(call => call.url.pathname.endsWith('/channels')).length, 1);
});

test('unknown server channels hydrate as server messages, and metadata failures remain partial', async t => {
  let fail = false; const { client } = await fixture(t, call => call.url.pathname.endsWith('/channels') ? fail ? Response.json({}, { status: 403 }) : Response.json([{ id: 'new-server-channel', kind: 'text', server_id: 'guild' }]) : undefined);
  const seen = []; client.on(Events.MessageCreate, message => seen.push(message));
  client._dispatch('message', { table: 'messages', operation: 'INSERT', record: { id: 'm1', channel_id: 'new-server-channel', content: 'Server' } }); await tick();
  assert.equal(seen[0].guildId, 'guild'); assert.equal(seen[0].channel.isDMBased(), false);
  fail = true; client._dispatch('message', { table: 'messages', operation: 'INSERT', record: { id: 'm2', channel_id: 'unavailable', content: 'Unknown' } }); await tick();
  assert.equal(seen[1].channel.isDMBased(), false); assert.equal(seen[1].guild, null);
});

test('destroy while DM creation awaits cannot resurrect channels or send a message', async () => {
  let release; const { client, calls } = setup(call => call.url.pathname.endsWith('/channels') ? new Promise(resolve => { release = () => resolve(Response.json([{ id: 'dm-channel', kind: 'dm' }])); }) : undefined);
  await client.login(session()); const pending = client.sendDM('alice', 'Hello'); await tick(); client.destroy(); release();
  await assert.rejects(pending); assert.equal(client.channels.cache.size, 0); assert.equal(calls.some(call => call.url.pathname.endsWith('/messages')), false);
});

test('automatic refresh retries network and server failures with backoff while keeping the session', async t => {
  const now = 1800000000000; t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  let attempts = 0, reconnects = 0; const saved = [], retries = [];
  const { client } = setup(call => {
    if (call.url.pathname.endsWith('/auth/v1/token')) { attempts++; if (attempts === 1) throw new Error('fake-secret'); if (attempts === 2) return Response.json({}, { status: 503 }); return Response.json(session('rotated')); }
  }, { autoRefresh: true, refreshRetryDelay: 1000, refreshRetryMaxDelay: 4000, sessionStore: { load: async () => null, save: async value => saved.push(value) } });
  t.after(() => client.destroy()); client.on(Events.RefreshRetry, metadata => retries.push(metadata)); await client.login(session('old', 120)); client.gateway.reauthenticate = () => reconnects++;
  t.mock.timers.tick(60001); await tick(); assert.equal(attempts, 1); assert.equal(client.isReady(), true); assert.equal(client.token, 'fake-access-old');
  t.mock.timers.tick(1000); await tick(); assert.equal(attempts, 2); t.mock.timers.tick(2000); await tick(); assert.equal(attempts, 3);
  assert.deepEqual(retries.map(value => value.retryIn), [1000, 2000]); assert.equal(saved.at(-1).refresh_token, 'fake-refresh-rotated'); assert.equal(reconnects, 1);
  assert.ok(!JSON.stringify(retries).includes('fake-secret')); assert.equal(client.auth.requiresLogin, false);
});

test('429 refresh retries honor Retry-After and short token lifetimes avoid tight loops', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 }); let attempts = 0;
  const { client } = setup(call => call.url.pathname.endsWith('/auth/v1/token') ? (++attempts === 1 ? Response.json({}, { status: 429, headers: { 'Retry-After': '10' } }) : Response.json(session('short', 20))) : undefined, { autoRefresh: true, refreshRetryDelay: 1000 });
  t.after(() => client.destroy()); await client.login(session()); await assert.rejects(client.auth.refresh());
  t.mock.timers.tick(9999); await tick(); assert.equal(attempts, 1); t.mock.timers.tick(1); await tick(); assert.equal(attempts, 2);
  t.mock.timers.tick(9000); await tick(); assert.equal(attempts, 2); t.mock.timers.tick(1001); await tick(); assert.equal(attempts, 3);
});

test('storage recovery persists the rotated pair without another exchange and reconnects once', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 }); let fail = false, exchanges = 0, rotations = 0, reconnects = 0;
  const store = new MemorySessionStore();
  const { client } = setup(call => call.url.pathname.endsWith('/auth/v1/token') ? (exchanges++, Response.json(session('rotated'))) : undefined, { autoRefresh: true, refreshRetryDelay: 1000, sessionStore: { load: () => store.load(), save: async value => { if (fail) throw new Error('disk full'); await store.save(value); } } });
  t.after(() => client.destroy()); await client.login(session()); client.gateway.reauthenticate = () => reconnects++; client.on(Events.TokenRefresh, () => rotations++);
  fail = true; await assert.rejects(client.auth.refresh(), SessionStorageError); assert.equal(client.token, 'fake-access-rotated'); assert.equal(rotations, 0);
  fail = false; t.mock.timers.tick(1000); await tick(); assert.equal(exchanges, 1); assert.equal((await store.load()).refresh_token, 'fake-refresh-rotated'); assert.equal(rotations, 1); assert.equal(reconnects, 1);
});

test('expired saved sessions recover after offline time using the latest persisted refresh token', async t => {
  const store = new MemorySessionStore(); let expected = 'fake-refresh-old';
  const handler = call => { if (call.url.pathname.endsWith('/auth/v1/token')) { assert.equal(call.body.refresh_token, expected); return Response.json(session('new')); } };
  const { client } = setup(handler, { sessionStore: store }); await client.login(session()); await client.auth.refresh(); client.destroy();
  const saved = await store.load(); saved.expires_at = Math.floor(Date.now() / 1000) - 7200; await store.save(saved); expected = 'fake-refresh-new';
  const { client: resumed } = setup(handler, { sessionStore: store }); t.after(() => resumed.destroy()); await resumed.login(); assert.equal(resumed.isReady(), true); assert.equal(resumed.token, 'fake-access-new');
});

test('revoked refresh tokens stop retries, emit metadata and permit a fresh explicit login', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 });
  let calls = 0; const { client } = setup(call => call.url.pathname.endsWith('/auth/v1/token') ? (calls++, Response.json({ code: 'refresh_token_not_found', message: 'fake-secret' }, { status: 400 })) : undefined, { autoRefresh: true });
  t.after(() => client.destroy()); const invalidated = []; client.on(Events.SessionInvalidated, metadata => invalidated.push(metadata)); await client.login(session());
  await assert.rejects(client.auth.refresh()); assert.equal(client.isReady(), false); assert.equal(client.auth.requiresLogin, true); assert.equal(invalidated.length, 1);
  await assert.rejects(client.auth.getAccessToken(), error => error.code === 'SESSION_INVALIDATED'); t.mock.timers.tick(3600000); await tick(); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(invalidated).includes('fake-secret')); await client.login(session('fresh')); assert.equal(client.isReady(), true); assert.equal(client.auth.requiresLogin, false);
});

test('destroy during a scheduled retry cancels future exchanges', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 }); let exchanges = 0;
  const { client } = setup(call => call.url.pathname.endsWith('/auth/v1/token') ? (exchanges++, Response.json({}, { status: 503 })) : undefined, { autoRefresh: true, refreshRetryDelay: 1000 });
  await client.login(session()); await assert.rejects(client.auth.refresh()); client.destroy(); t.mock.timers.tick(10000); await tick(); assert.equal(exchanges, 1);
});

test('legacy create persistence is in the consuming application and never the package folder', async t => {
  const path = require('node:path'); const { FileSessionStore } = require('../YapperJS'); let savedAt;
  t.mock.method(FileSessionStore.prototype, 'load', async () => null);
  t.mock.method(FileSessionStore.prototype, 'save', async function() { savedAt = this.path; });
  t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('/auth/v1/user') ? Response.json({ id: 'self' }) : Response.json({}));
  const client = await Client.create(JSON.stringify(session()), 'fake-public', true); t.after(() => client.destroy());
  assert.equal(savedAt, path.resolve('.data/yapper-session.json'));
});

test('network failures while reading refresh responses are sanitized and retryable', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 }); let attempts = 0;
  const { client } = setup(call => call.url.pathname.endsWith('/auth/v1/token') ? (++attempts === 1 ? { status: 200, ok: true, text: async () => { throw new Error('fake-secret'); } } : Response.json(session('recovered'))) : undefined, { autoRefresh: true, refreshRetryDelay: 1000 });
  t.after(() => client.destroy()); await client.login(session()); await assert.rejects(client.auth.refresh(), error => error.code === 'NETWORK_ERROR' && !error.message.includes('fake-secret'));
  t.mock.timers.tick(1000); await tick(); assert.equal(client.token, 'fake-access-recovered');
});
