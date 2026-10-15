'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Events, GuildMember, GuildMemberManager } = require('../YapperJS');
const session = { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'self' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(extra = {}, handler) {
  const data = { profiles: [{ id: 'self', username: 'bot' }, { id: 'alice', username: 'Alice' }], servers: [{ id: 'guild', name: 'Test' }], channels: [{ id: 'channel', server_id: 'guild', name: 'general', kind: 'text' }], dm_channels: [{ id: 'dm', kind: 'dm' }], members: { guild: [['self', 0], ['alice', 1700000000, 'Ali']] } };
  const calls = [];
  const client = new Client({ apiKey: 'fake-public', realtime: false, autoRefresh: false, ...extra, fetch: async (url, options) => {
    const call = { url: new URL(url), options }; calls.push(call);
    if (handler) { const response = await handler(call, data); if (response !== undefined) return response; }
    if (call.url.pathname === '/auth/v1/user') return Response.json(session.user);
    if (call.url.pathname.endsWith('/rpc/bootstrap')) return Response.json(data);
    return Response.json([]);
  } });
  const dispatch = (operation, row) => client._dispatch('member', { table: 'server_members', operation, [operation === 'DELETE' ? 'old_record' : 'record']: row });
  return { client, data, calls, dispatch };
}

test('bootstrap hydrates member models without firing join events and keeps server identity', async t => {
  const { client } = setup(); t.after(() => client.destroy()); let joins = 0;
  client.on(Events.GuildMemberAdd, () => joins++); await client.login(session);
  const guild = client.guilds.cache.get('guild'), member = guild.members.get('alice');
  assert.ok(guild.members instanceof GuildMemberManager); assert.ok(member instanceof GuildMember);
  assert.equal(guild.members.cache, guild.members); assert.equal(guild.members.size, 2);
  assert.equal(member.guild, guild); assert.equal(member.user, client.users.cache.get('alice')); assert.equal(member.displayName, 'Ali');
  assert.equal(member.joinedTimestamp, 1700000000000); assert.equal(guild.members.get('self').joinedAt.getTime(), 0);
  await client.fetchBootstrap(); assert.equal(client.guilds.cache.get('guild'), guild); assert.equal(joins, 0);
});

test('compound-key joins update caches before listeners, suppress duplicates and allow rejoining', async t => {
  const { client, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session);
  const guild = client.guilds.cache.get('guild'); let joins = 0, leaves = 0;
  client.on(Events.GuildMemberAdd, member => { joins++; assert.equal(guild.members.cache.get(member.id), member); });
  client.on(Events.GuildMemberRemove, () => leaves++);
  const row = { server_id: 'guild', user_id: 'new', joined_at: '2026-10-15T12:00:00Z', nickname: 'New' };
  dispatch('INSERT', row); dispatch('INSERT', row); assert.equal(joins, 1);
  assert.equal(guild.members.get('new').user, null); assert.equal(guild.members.get('new').partial, false);
  assert.ok(client._members.guild.some(row => row.user_id === 'new'));
  dispatch('DELETE', row); dispatch('DELETE', row); assert.equal(leaves, 1);
  assert.equal(guild.members.has('new'), false); assert.equal(client._members.guild.some(row => row.user_id === 'new'), false);
  dispatch('INSERT', row); assert.equal(joins, 2); dispatch('DELETE', row); assert.equal(leaves, 2);
});

test('updates preserve independent old values and support nickname clearing', async t => {
  const { client, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session); const updates = [];
  client.on(Events.GuildMemberUpdate, (...args) => updates.push(args));
  dispatch('UPDATE', { server_id: 'guild', user_id: 'alice', nickname: 'Changed' });
  const [old, member] = updates[0]; assert.notEqual(old, member); assert.equal(old.nickname, 'Ali'); assert.equal(member.nickname, 'Changed');
  dispatch('UPDATE', { server_id: 'guild', user_id: 'alice', nickname: 'Changed' }); assert.equal(updates.length, 1);
  dispatch('UPDATE', { server_id: 'guild', user_id: 'alice', nickname: null }); assert.equal(updates.length, 2);
  assert.equal(member.displayName, 'Alice'); assert.equal(old.nickname, 'Ali'); assert.equal(member.joinedTimestamp, 1700000000000);
});

test('uncached updates and removals expose partial members without inventing user profiles', async t => {
  const { client, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session); let previous, updated, removed;
  client.on(Events.GuildMemberUpdate, (a, b) => { previous = a; updated = b; });
  client.on(Events.GuildMemberRemove, member => { removed = member; });
  dispatch('UPDATE', { server_id: 'guild', user_id: 'missing', nickname: 'Someone' });
  assert.equal(previous, null); assert.equal(updated.partial, true); assert.equal(updated.user, null);
  dispatch('DELETE', { server_id: 'guild', user_id: 'never-cached' }); assert.equal(removed.id, 'never-cached'); assert.equal(removed.partial, true);
  assert.equal(removed.guild.id, 'guild'); assert.equal(client.users.cache.has('never-cached'), false);
});

test('malformed, unsupported and unrelated member events leave caches unchanged', async t => {
  const { client, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session); let events = 0;
  for (const name of [Events.GuildMemberAdd, Events.GuildMemberRemove, Events.GuildMemberUpdate]) client.on(name, () => events++);
  dispatch('INSERT', { user_id: 'new' }); dispatch('DELETE', null); dispatch('UPSERT', { server_id: 'guild', user_id: 'new' });
  dispatch('INSERT', { server_id: 'hidden', user_id: 'new' }); assert.equal(events, 0); assert.equal(client.guilds.cache.size, 1);
});

test('member fetches scope both server and user IDs; cached reads avoid HTTP', async t => {
  const { client, calls } = setup({}, call => {
    if (call.url.pathname.endsWith('/server_members')) return Response.json([{ server_id: 'guild', user_id: 'alice', nickname: 'Fetched', joined_at: '2026-10-15T12:00:00Z' }]);
  }); t.after(() => client.destroy()); await client.login(session);
  const guild = client.guilds.cache.get('guild'), count = calls.length;
  assert.equal(await guild.members.fetch(), guild.members.cache); await guild.members.fetch('alice'); assert.equal(calls.length, count);
  const member = await guild.members.fetch('alice', { force: true }), call = calls.at(-1);
  assert.equal(member.nickname, 'Fetched'); assert.equal(call.url.searchParams.get('server_id'), 'eq.guild'); assert.equal(call.url.searchParams.get('user_id'), 'eq.alice');
  assert.equal(call.url.searchParams.get('select'), 'server_id,user_id,nickname,joined_at');
  assert.equal((await member.fetch()), member);
  assert.throws(() => guild.members._add({ server_id: 'other', user_id: 'bad' }), /another server/);
});

test('server messages expose guild/member context for creates, edits and deletes; DMs do not', async t => {
  const { client } = setup(); t.after(() => client.destroy()); await client.login(session); const events = [];
  client.on(Events.MessageCreate, message => events.push(message));
  client.on(Events.MessageUpdate, (old, message) => { assert.equal(old.content, 'Hello'); events.push(message); });
  client.on(Events.MessageDelete, message => events.push(message));
  const row = { id: 'm', channel_id: 'channel', author_id: 'alice', content: 'Hello' };
  client._dispatch('message', { table: 'messages', operation: 'INSERT', record: row });
  client._dispatch('message', { table: 'messages', operation: 'INSERT', record: row });
  client._dispatch('message', { table: 'messages', operation: 'UPDATE', record: { ...row, content: 'Edited' } });
  client._dispatch('message', { table: 'messages', operation: 'DELETE', old_record: { id: 'm' } });
  assert.equal(events.length, 3);
  for (const message of events) { assert.equal(message.inGuild(), true); assert.equal(message.guildId, 'guild'); assert.equal(message.member.id, 'alice'); }
  const dm = client._messageManager('dm')._add({ id: 'dm-m', author_id: 'alice', content: 'Private' });
  assert.equal(dm.inGuild(), false); assert.equal(dm.member, null); assert.equal(dm.guildId, null);
  assert.equal(client._getMessage('partial').member, null);
});

test('self removal emits memberRemove then guildDelete and prunes server channels/subscriptions', async t => {
  const { client, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session); const order = [];
  const guild = client.guilds.cache.get('guild');
  client.on(Events.GuildMemberRemove, member => order.push(`member:${member.id}`));
  client.on(Events.GuildDelete, server => { order.push(`guild:${server.id}`); assert.equal(server, guild); });
  dispatch('DELETE', { server_id: 'guild', user_id: 'self' }); dispatch('DELETE', { server_id: 'guild', user_id: 'self' });
  assert.deepEqual(order, ['member:self', 'guild:guild']); assert.equal(client.guilds.cache.size, 0);
  assert.equal(client.channels.cache.has('channel'), false); assert.equal(client.channels.cache.has('dm'), true); assert.equal(client._members.guild, undefined);
  assert.equal(client.gateway.topics().has('server:guild'), false);
});

test('server deletion clears related channel and legacy member caches', async t => {
  const { client } = setup(); t.after(() => client.destroy()); await client.login(session); let deleted;
  client.on(Events.GuildDelete, guild => { deleted = guild; });
  client._dispatch('server', { table: 'servers', operation: 'DELETE', old_record: { id: 'guild' } });
  assert.equal(deleted.name, 'Test'); assert.equal(client.channels.cache.has('channel'), false); assert.equal(client._members.guild, undefined);
});

test('self join hydrates a newly visible server once and does not announce historical members', async t => {
  const { client, data, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session);
  data.servers.push({ id: 'new-guild', name: 'New server' }); data.channels.push({ id: 'new-channel', server_id: 'new-guild', kind: 'text' });
  data.members['new-guild'] = [['self', 1700000000], ['alice', 1700000000]];
  const events = []; client.on(Events.GuildCreate, guild => events.push(`guild:${guild.id}`)); client.on(Events.GuildMemberAdd, member => events.push(`member:${member.id}`));
  const row = { server_id: 'new-guild', user_id: 'self', joined_at: '2026-10-15T12:00:00Z' };
  dispatch('INSERT', row); dispatch('INSERT', row); await tick();
  assert.deepEqual(events, ['guild:new-guild', 'member:self']); assert.equal(client.guilds.cache.get('new-guild').members.size, 2);
  assert.equal(client.channels.cache.get('new-channel').guild.id, 'new-guild');
});

test('leave or destruction during self join hydration prevents stale bootstrap application', async () => {
  for (const cancel of ['leave', 'destroy']) {
    let release, pending = false;
    const { client, data, dispatch } = setup({}, call => {
      if (pending && call.url.pathname.endsWith('/rpc/bootstrap')) return new Promise(resolve => { release = () => resolve(Response.json(data)); });
    });
    await client.login(session); pending = true; data.servers.push({ id: 'new-guild' }); data.members['new-guild'] = [['self', 0]];
    dispatch('INSERT', { server_id: 'new-guild', user_id: 'self' }); await tick();
    if (cancel === 'leave') dispatch('DELETE', { server_id: 'new-guild', user_id: 'self' }); else client.destroy();
    release(); await tick(); assert.equal(client.guilds.cache.has('new-guild'), false); client.destroy();
  }
});

class MockSocket {
  static instances = [];
  constructor() { this.listeners = new Map(); this.readyState = 0; this.sent = []; MockSocket.instances.push(this); }
  addEventListener(event, listener) { this.listeners.set(event, listener); }
  send(value) { const data = JSON.parse(value); this.sent.push(data); if (data.type === 'auth') queueMicrotask(() => this.receive({ type: 'auth', ok: true })); }
  open() { this.readyState = 1; this.listeners.get('open')(); }
  receive(data) { this.listeners.get('message')({ data: JSON.stringify(data) }); }
  close() { this.readyState = 3; }
}

test('gateway forwards actual member event envelopes after authentication', async t => {
  const { client } = setup({ realtime: true, WebSocket: MockSocket }); t.after(() => client.destroy());
  const login = client.login(session); await tick(); const socket = MockSocket.instances.at(-1); socket.open(); await login;
  assert.ok(socket.sent.some(packet => packet.type === 'subscribe' && packet.topics.includes('server:guild')));
  let joined; client.on(Events.GuildMemberAdd, member => { joined = member; });
  socket.receive({ type: 'event', event: 'member', payload: { table: 'server_members', operation: 'INSERT', record: { server_id: 'guild', user_id: 'bob', nickname: 'B' } } });
  assert.equal(joined.id, 'bob'); assert.equal(joined.guild.name, 'Test');
});

test('sample event handlers are scoped to configured server channels and message logging is optional', async t => {
  const { client, dispatch } = setup(); t.after(() => client.destroy()); await client.login(session);
  const registerEvents = require('../bot/events'); const log = [], announcements = [];
  client.channels.cache.get('channel').send = async text => { announcements.push(text); };
  registerEvents(client, { log: text => log.push(text), welcomeChannels: { guild: 'channel' } });
  dispatch('INSERT', { server_id: 'guild', user_id: 'bob', nickname: 'B' }); await tick();
  dispatch('DELETE', { server_id: 'guild', user_id: 'bob' }); await tick();
  assert.deepEqual(announcements, ['Welcome B!', 'B left the server.']); assert.equal(log.length, 2);
  client.emit(Events.MessageCreate, client._messageManager('channel')._add({ id: 'm', author_id: 'alice', content: 'Hello' }));
  assert.equal(log.length, 2);
});

test('a pending member fetch cannot repopulate a removed server', async t => {
  let release;
  const { client, dispatch } = setup({}, call => {
    if (call.url.pathname.endsWith('/server_members')) return new Promise(resolve => { release = () => resolve(Response.json([{ server_id: 'guild', user_id: 'alice', nickname: 'Fetched' }])); });
  }); t.after(() => client.destroy()); await client.login(session);
  const fetch = client.guilds.cache.get('guild').members.fetch('alice', { force: true }); await tick();
  dispatch('DELETE', { server_id: 'guild', user_id: 'self' }); release();
  assert.equal(await fetch, null); assert.equal(client._members.guild, undefined);
});

test('a server row arriving during self join hydration does not emit guildCreate twice', async t => {
  let release, pending = false;
  const { client, data, dispatch } = setup({}, call => {
    if (pending && call.url.pathname.endsWith('/rpc/bootstrap')) return new Promise(resolve => { release = () => resolve(Response.json(data)); });
  }); t.after(() => client.destroy()); await client.login(session); pending = true;
  data.servers.push({ id: 'new-guild', name: 'New' }); data.members['new-guild'] = [['self', 0]];
  let creates = 0; client.on(Events.GuildCreate, () => creates++);
  dispatch('INSERT', { server_id: 'new-guild', user_id: 'self' }); await tick();
  client._dispatch('server', { table: 'servers', operation: 'INSERT', record: { id: 'new-guild', name: 'New' } });
  release(); await tick(); assert.equal(creates, 1);
});
