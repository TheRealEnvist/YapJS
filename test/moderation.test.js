'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Events, Role, GuildBan, YapperAPIError, MessageBulkDeleteError } = require('../YapperJS');
const session = { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_at: 4102444800, user: { id: 'self' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(handler) {
  const calls = [], roles = new Map([['role', { id: 'role', server_id: 'guild', name: 'Helpers', color: '#112233', color2: '#445566', position: 2, manage_server: false, manage_messages: true, perms: { manage_messages: true }, auto: 'none' }], ['foreign', { id: 'foreign', server_id: 'other', name: 'Foreign', position: 1, auto: 'none' }]]);
  const bans = new Map(), messages = new Map(['m1', 'm2', 'm3'].map((id, index) => [id, { id, channel_id: 'channel', author_id: 'alice', content: id, created_at: new Date(1700000000000 + index * 1000).toISOString() }])); let sequence = 0;
  const data = { profiles: [{ id: 'self', username: 'Bot' }, { id: 'alice', username: 'Alice' }, { id: 'bob', username: 'Bob' }], servers: [{ id: 'guild', name: 'Test', owner_id: 'self' }, { id: 'other', name: 'Other' }], channels: [{ id: 'channel', server_id: 'guild', kind: 'text' }, { id: 'foreign-channel', server_id: 'other', kind: 'text' }], dm_channels: [{ id: 'dm', kind: 'dm' }], members: { guild: [['self', 0], ['alice', 1700000000, 'Ali'], ['bob', 1700000000]], other: [['bob', 1700000000]] }, roles: [...roles.values()], member_roles: [['guild', 'alice', 'role']] };
  const filter = (values, url) => values.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || row[key] === value.slice(3)));
  const fetch = async (url, options) => {
    const call = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
    if (handler) { const custom = await handler(call, { roles, bans, messages, data }); if (custom !== undefined) return custom; }
    const route = call.url.pathname;
    if (route === '/auth/v1/user') return Response.json(session.user);
    if (route.endsWith('/rpc/bootstrap')) return Response.json(data);
    if (route.endsWith('/roles')) {
      if (options.method === 'POST') { const row = { ...call.body, id: `new-role-${++sequence}`, auto: 'none', perms: {} }; roles.set(row.id, row); return Response.json([row]); }
      const rows = filter([...roles.values()], call.url);
      if (options.method === 'PATCH') rows.forEach(row => Object.assign(row, call.body));
      if (options.method === 'DELETE') rows.forEach(row => roles.delete(row.id));
      const offset = Number(call.url.searchParams.get('offset') ?? 0), limit = Number(call.url.searchParams.get('limit') ?? 500);
      return Response.json(rows.slice(offset, offset + limit));
    }
    if (route.endsWith('/server_bans')) {
      const offset = Number(call.url.searchParams.get('offset') ?? 0); return Response.json(filter([...bans.values()], call.url).slice(offset, offset + Number(call.url.searchParams.get('limit') ?? 500)));
    }
    if (route.endsWith('/rpc/ban_member')) bans.set(call.body.target, { server_id: call.body.sid, user_id: call.body.target, created_at: '2026-10-15T12:00:00Z' });
    if (route.endsWith('/rpc/unban_member')) bans.delete(call.body.target);
    if (route.endsWith('/server_members')) return Response.json([{ server_id: 'guild', user_id: 'alice', nickname: 'Ali', joined_at: '2023-11-14T22:13:20Z' }]);
    if (route.endsWith('/messages')) {
      if (options.method === 'POST') { const row = { ...call.body }; messages.set(row.id, row); return Response.json([row]); }
      const rows = filter([...messages.values()], call.url);
      if (options.method === 'DELETE') rows.forEach(row => messages.delete(row.id));
      return Response.json(rows.slice(0, Number(call.url.searchParams.get('limit') ?? rows.length)));
    }
    return new Response(null, { status: 204 });
  };
  const client = new Client({ apiKey: 'fake-public', fetch, realtime: false, autoRefresh: false, commands: { owners: ['alice'] } });
  return { client, calls, roles, bans, messages, data };
}
async function fixture(t, handler) { const result = setup(handler); await result.client.login(session); t.after(() => result.client.destroy()); result.guild = result.client.guilds.cache.get('guild'); return result; }

test('bootstrap hydrates manual and automatic roles without inventing events', async t => {
  const { client, data } = setup(); t.after(() => client.destroy());
  data.roles.push({ id: 'auto', server_id: 'guild', name: 'Everyone badge', auto: 'all' }, { id: 'before', server_id: 'guild', auto: 'before', auto_before: '2020-01-01T00:00:00Z' });
  let creates = 0; client.on(Events.RoleCreate, () => creates++); await client.login(session);
  const guild = client.guilds.cache.get('guild'), alice = guild.members.get('alice');
  assert.ok(guild.roles.cache.get('role') instanceof Role); assert.equal(alice.roles.cache.has('role'), true); assert.equal(alice.roles.cache.has('auto'), true);
  assert.equal(alice.roles.cache.has('before'), false); assert.equal(guild.members.get('self').roles.cache.has('before'), true);
  assert.equal(guild.roles.cache.get('role').members.get('alice'), alice); assert.equal(creates, 0);
});

test('role creation uses observed fields, serializes position allocation and merges gateway echoes', async t => {
  const { guild, client, calls } = await fixture(t); let created = 0; client.on(Events.RoleCreate, () => created++);
  const [first, second] = await Promise.all([guild.roles.create({ name: 'Mods', color: '#aabbcc', manageMessages: true }), guild.roles.create({ name: 'Other' })]);
  assert.equal(first.position, 3); assert.equal(second.position, 4); assert.equal(created, 2);
  const writes = calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/roles'));
  assert.deepEqual(writes[0].body, { server_id: 'guild', name: 'Mods', color: '#aabbcc', position: 3, manage_server: false, manage_messages: true });
  client._dispatch('roles', { table: 'roles', operation: 'INSERT', record: { ...writes[0].body, id: first.id } }); assert.equal(created, 2);
});

test('partial role edits preserve unspecified fields and emit independent snapshots once', async t => {
  const { guild, client, calls } = await fixture(t); const updates = []; client.on(Events.RoleUpdate, (...args) => updates.push(args));
  const role = await guild.roles.cache.get('role').setName('Moderators'); assert.equal(role.color, '#112233'); assert.equal(role.manageMessages, true);
  const write = calls.findLast(call => call.options.method === 'PATCH'); assert.deepEqual(write.body, { name: 'Moderators' });
  assert.equal(write.url.searchParams.get('server_id'), 'eq.guild'); assert.equal(updates[0][0].name, 'Helpers'); assert.equal(updates[0][1], role);
  client._dispatch('roles', { table: 'roles', operation: 'UPDATE', record: { id: 'role', server_id: 'guild', name: 'Moderators' } }); assert.equal(updates.length, 1);
  await role.setPermissions({ kick_members: true, ban_members: true }); assert.deepEqual(role.permissions, { kick_members: true, ban_members: true });
  assert.deepEqual(updates[1][0].permissions, { manage_messages: true }); assert.ok(Object.isFrozen(role.permissions));
  await role.setColor(null); assert.equal(role.color2, null);
});

test('role deletion removes assignments and emits roleDelete once for local and gateway delivery', async t => {
  const { guild, client, calls } = await fixture(t); let deletes = 0; client.on(Events.RoleDelete, () => deletes++);
  const deleted = await guild.roles.cache.get('role').delete(); assert.equal(deleted.id, 'role'); assert.equal(guild.roles.cache.has('role'), false); assert.equal(guild.members.get('alice').roles.cache.has('role'), false);
  const call = calls.at(-1); assert.equal(call.url.searchParams.get('server_id'), 'eq.guild');
  client._dispatch('roles', { table: 'roles', operation: 'DELETE', old_record: { id: 'role' } }); assert.equal(deletes, 1);
});

test('denied or empty role mutations preserve caches and events', async t => {
  let fail = false, empty = false;
  const { guild, client } = await fixture(t, call => fail && ['POST', 'PATCH', 'DELETE'].includes(call.options.method) && call.url.pathname.endsWith('/roles') ? Response.json(empty ? [] : {}, { status: empty ? 200 : 403 }) : undefined);
  const original = guild.roles.cache.get('role'); let events = 0; client.on(Events.RoleUpdate, () => events++); client.on(Events.RoleDelete, () => events++); fail = true;
  await assert.rejects(original.setName('Denied'), YapperAPIError); await assert.rejects(original.delete(), YapperAPIError); await assert.rejects(guild.roles.create({ name: 'Denied' }), YapperAPIError);
  empty = true; await assert.rejects(original.delete(), /not deleted/); await assert.rejects(original.edit({ name: 'Empty' }), /not edited/);
  assert.equal(original.name, 'Helpers'); assert.equal(guild.roles.cache.get('role'), original); assert.equal(events, 0);
});

test('cross-server role and member objects cannot produce mutation requests', async t => {
  const { client, guild, calls } = await fixture(t); const foreign = client.guilds.cache.get('other').roles.cache.get('foreign'), member = client.guilds.cache.get('other').members.get('bob');
  const start = calls.length;
  await assert.rejects(guild.roles.edit(foreign, { name: 'Bad' }), /another server/); await assert.rejects(guild.roles.delete(foreign), /another server/);
  await assert.rejects(guild.members.kick(member), /another server/); await assert.rejects(guild.bans.create(member), /another server/);
  assert.throws(() => guild.members.setNickname(member, 'Bad'), /another server/); assert.equal(calls.length, start);
  await assert.rejects(guild.roles.edit('foreign', { name: 'Bad' }), /unavailable/); assert.ok(!calls.slice(start).some(call => call.options.method === 'PATCH'));
});

test('role validation rejects unsupported fields, invalid colors and dates before writes', async t => {
  const { guild, calls } = await fixture(t); const count = calls.length;
  assert.throws(() => guild.roles.create({ name: 'x', permissions: { administrator: true } }), /Unsupported/);
  assert.throws(() => guild.roles.create({ color: 'red' }), TypeError); assert.throws(() => guild.roles.create({ position: -1 }), RangeError);
  await assert.rejects(guild.roles.edit('role', { permissions: { manage_server: 'yes' } }), TypeError);
  await assert.rejects(guild.roles.edit('role', { auto: 'before', autoBefore: 'invalid' }), TypeError);
  await assert.rejects(guild.roles.edit('role', { auto: 'before' }), /require autoBefore/); assert.equal(calls.length, count);
});

test('role ordering uses highest-first IDs and updates positions only after success', async t => {
  const { guild, calls } = await fixture(t); const other = await guild.roles.create({ name: 'Other' });
  await guild.roles.setPositions([other.id, 'role']); const call = calls.findLast(call => call.url.pathname.endsWith('/reorder_roles'));
  assert.deepEqual(call.body, { sid: 'guild', ids: [other.id, 'role'] }); assert.equal(other.position, 1); assert.equal(guild.roles.cache.get('role').position, 0);
  await assert.rejects(guild.roles.setPositions(['role', 'role']), /Duplicate/);
});

test('role and ban list reads paginate inside the server filter', async t => {
  const { guild, roles, bans, calls } = await fixture(t);
  for (let i = 0; i < 501; i++) { roles.set(`r${i}`, { id: `r${i}`, server_id: 'guild', name: `R${i}` }); bans.set(`u${i}`, { server_id: 'guild', user_id: `u${i}`, created_at: '2026-10-15T12:00:00Z' }); }
  assert.equal((await guild.roles.fetch()).size, 502); assert.equal((await guild.bans.fetch()).size, 501);
  for (const table of ['roles', 'server_bans']) {
    const pages = calls.filter(call => call.url.pathname.endsWith('/' + table)); assert.deepEqual(pages.map(call => call.url.searchParams.get('offset')), ['0', '500']); assert.ok(pages.every(call => call.url.searchParams.get('server_id') === 'eq.guild'));
  }
});

test('kicking and banning use verified RPC arguments and synchronize member removal once', async t => {
  const { client, guild, calls } = await fixture(t); const leaves = []; client.on(Events.GuildMemberRemove, member => leaves.push(member.id));
  await guild.members.get('alice').kick(); assert.deepEqual(calls.at(-1).body, { sid: 'guild', target: 'alice' }); assert.equal(guild.members.has('alice'), false);
  client._dispatch('member', { table: 'server_members', operation: 'DELETE', old_record: { server_id: 'guild', user_id: 'alice' } }); assert.deepEqual(leaves, ['alice']);
  const ban = await guild.members.get('bob').ban(); assert.ok(ban instanceof GuildBan); assert.equal(guild.bans.cache.get('bob'), ban); assert.equal(ban.createdAt, null); assert.equal(ban.user.id, 'bob');
  assert.deepEqual(calls.at(-1).body, { sid: 'guild', target: 'bob' }); assert.equal(guild.members.has('bob'), false);
  const authoritative = await guild.bans.fetch('bob'); assert.equal(authoritative.createdAt.toISOString(), '2026-10-15T12:00:00.000Z');
  await authoritative.remove(); assert.equal(guild.bans.cache.has('bob'), false); assert.equal(calls.at(-1).url.pathname, '/rest/v1/rpc/unban_member');
});

test('denied member actions and unbans leave all caches intact', async t => {
  let fail = false; const { guild } = await fixture(t, call => fail && ['/kick_member', '/ban_member', '/unban_member', '/set_nickname', '/server_timeout'].some(route => call.url.pathname.endsWith(route)) ? Response.json({}, { status: 403 }) : undefined);
  const alice = guild.members.get('alice'); fail = true;
  await assert.rejects(alice.kick(), YapperAPIError); await assert.rejects(alice.ban(), YapperAPIError); await assert.rejects(alice.setNickname('Bad'), YapperAPIError); await assert.rejects(alice.timeout(60000), YapperAPIError);
  assert.equal(guild.members.get('alice'), alice); assert.equal(alice.nickname, 'Ali'); assert.equal(guild.bans.cache.size, 0);
  fail = false; const ban = await guild.bans.create('bob'); fail = true; await assert.rejects(ban.remove(), YapperAPIError); assert.equal(guild.bans.cache.get('bob'), ban);
});

test('timeouts convert whole-minute milliseconds and pass the supported reason', async t => {
  const { guild, calls } = await fixture(t); const member = guild.members.get('alice'); await member.timeout(600000, 'Spam');
  assert.deepEqual(calls.at(-1).body, { sid: 'guild', target: 'alice', minutes: 10, why: 'Spam' });
  const count = calls.length; await assert.rejects(member.timeout(1000), RangeError); await assert.rejects(member.timeout(0), RangeError); await assert.rejects(member.timeout(null), RangeError); await assert.rejects(member.timeout(-60000), RangeError); await assert.rejects(member.timeout(60000, 'x'.repeat(201)), RangeError); assert.equal(calls.length, count);
});

test('nickname changes update caches and emit only once across REST and gateway', async t => {
  const { client, guild, calls } = await fixture(t); const events = []; client.on(Events.GuildMemberUpdate, (...args) => events.push(args));
  const member = guild.members.get('alice'); await member.setNickname('Changed'); assert.equal(member.nickname, 'Changed'); assert.equal(events[0][0].nickname, 'Ali'); assert.deepEqual(calls.at(-1).body, { sid: 'guild', target: 'alice', nick: 'Changed' });
  client._dispatch('member', { table: 'server_members', operation: 'UPDATE', record: { server_id: 'guild', user_id: 'alice', nickname: 'Changed' } }); assert.equal(events.length, 1);
  await guild.members.setNickname('alice', null); assert.equal(member.nickname, null);
});

test('member role assignment is server scoped, deduplicates echoes, and snapshots prior assignments', async t => {
  const { client, guild, calls } = await fixture(t); const alice = guild.members.get('alice'); const events = []; client.on(Events.GuildMemberUpdate, (...args) => events.push(args));
  await alice.roles.remove('role'); assert.equal(alice.roles.cache.has('role'), false); assert.equal(events[0][0].roles.cache.has('role'), true);
  const deletion = calls.at(-1); for (const [key, value] of Object.entries({ server_id: 'guild', user_id: 'alice', role_id: 'role' })) assert.equal(deletion.url.searchParams.get(key), `eq.${value}`);
  await alice.roles.add('role'); assert.equal(alice.roles.cache.has('role'), true); assert.deepEqual(calls.at(-1).body, { server_id: 'guild', user_id: 'alice', role_id: 'role' });
  client._dispatch('roles', { table: 'member_roles', operation: 'INSERT', record: { server_id: 'guild', user_id: 'alice', role_id: 'role' } }); assert.equal(events.length, 2);
});

test('duplicate role assignments recover from conflicts, while denied assignments preserve caches', async t => {
  let status = 409; const { guild } = await fixture(t, call => call.url.pathname.endsWith('/member_roles') && call.options.method === 'POST' ? Response.json({ code: status === 409 ? '23505' : '42501' }, { status }) : undefined);
  const bob = guild.members.get('bob'); await bob.roles.add('role'); assert.equal(bob.roles.cache.has('role'), true);
  await bob.roles.remove('role'); status = 403; await assert.rejects(bob.roles.add('role'), YapperAPIError); assert.equal(bob.roles.cache.has('role'), false);
  guild.roles._add({ id: 'auto', server_id: 'guild', auto: 'all' }); await assert.rejects(bob.roles.add('auto'), /Automatic/); await assert.rejects(bob.roles.remove('auto'), /Automatic/);
});

test('message deletion stops collectors immediately and suppresses gateway echoes', async t => {
  const { client, guild, messages } = await fixture(t); const manager = guild.channels.resolve('channel').messages;
  const message = manager._add(messages.get('m1')); const collector = message.createReactionCollector({ time: 1000 }); let deletes = 0; client.on(Events.MessageDelete, () => deletes++);
  await message.delete(); assert.equal(collector.ended, true); assert.equal(manager.cache.has('m1'), false); assert.equal(deletes, 1);
  client._dispatch('message', { table: 'messages', operation: 'DELETE', old_record: { id: 'm1', channel_id: 'channel' } }); assert.equal(deletes, 1);
});

test('batch deletion validates every target before writing and returns successful deletions', async t => {
  const { guild, client, calls } = await fixture(t); const channel = guild.channels.resolve('channel'); const before = calls.length;
  await assert.rejects(channel.bulkDelete(['m1', { id: 'm2', channelId: 'foreign-channel' }]), /another channel/); assert.equal(calls.length, before);
  const deleted = await channel.bulkDelete(['m1', 'm1', 'm2']); assert.deepEqual([...deleted.keys()], ['m1', 'm2']);
  for (const call of calls.filter(call => call.options.method === 'DELETE' && call.url.pathname.endsWith('/messages'))) assert.equal(call.url.searchParams.get('channel_id'), 'eq.channel');
  assert.equal(client.channels.cache.get('channel').messages.cache.has('m1'), false); await assert.rejects(channel.bulkDelete(101), RangeError);
});

test('batch deletion stops on denial and reports partial progress without deleting later messages', async t => {
  const { guild, messages, calls } = await fixture(t, call => call.options.method === 'DELETE' && call.url.pathname.endsWith('/messages') && call.url.searchParams.get('id') === 'eq.m2' ? Response.json({}, { status: 403 }) : undefined);
  await assert.rejects(guild.channels.resolve('channel').bulkDelete(['m1', 'm2', 'm3']), error => {
    assert.ok(error instanceof MessageBulkDeleteError); assert.deepEqual([...error.deleted.keys()], ['m1']); assert.equal(error.failedId, 'm2'); assert.equal(error.cause.status, 403); return true;
  });
  assert.equal(messages.has('m1'), false); assert.equal(messages.has('m3'), true); assert.equal(calls.filter(call => call.options.method === 'DELETE').length, 2);
});

test('owner-only moderation commands reject ordinary users and DMs before API calls', async t => {
  const { client, calls } = await fixture(t); require('../bot/moderation')(client);
  const incoming = (content, author = 'bob', channel = 'channel') => client._messageManager(channel)._add({ id: `command-${calls.length}`, channel_id: channel, author_id: author, content });
  for (const name of ['kick', 'ban', 'unban', 'timeout', 'nick', 'deletemessage', 'purge', 'role']) assert.equal(client.commands.resolve(name).ownerOnly, true);
  const before = calls.length; await client.commands.handle(incoming('!ban alice')); await client.commands.handle(incoming('!role create Admins', 'alice', 'dm')); assert.equal(calls.length, before);
  await client.commands.handle(incoming('!kick bob', 'alice')); assert.ok(calls.some(call => call.url.pathname.endsWith('/kick_member') && call.body.target === 'bob'));
  await client.commands.handle(incoming('!role create "Chat Helpers" #aabbcc', 'alice')); assert.ok(calls.some(call => call.url.pathname.endsWith('/roles') && call.body?.name === 'Chat Helpers'));
});

test('destroyed clients and removed servers cannot initiate moderation', async () => {
  const { client, calls } = setup(); await client.login(session); const guild = client.guilds.cache.get('guild'); client.destroy(); const count = calls.length;
  await assert.rejects(guild.members.kick('alice'), /Sign in/); await assert.rejects(guild.roles.create({ name: 'x' }), /Sign in/); await assert.rejects(guild.bans.create('alice'), /Sign in/); assert.equal(calls.length, count);
});

test('setPermissions clears legacy grants, and before-role dates cannot be cleared alone', async t => {
  const { guild } = await fixture(t); const role = guild.roles.cache.get('role');
  await role.setPermissions({ kick_members: true }); assert.equal(role.manageMessages, false); assert.equal(role.manageServer, false);
  await role.edit({ auto: 'before', autoBefore: '2020-01-01T00:00:00Z' });
  await assert.rejects(role.edit({ autoBefore: null }), /require autoBefore/);
  await role.edit({ auto: 'none' }); assert.equal(role.autoBefore, null);
});
