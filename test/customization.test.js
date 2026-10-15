'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, ClientUser, Events, YapperAPIError } = require('../YapperJS');
const session = { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_at: 4102444800, user: { id: 'self', user_metadata: { username: 'tester' } } };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(handler = () => undefined, options = {}) {
  const calls = [];
  const profile = { id: 'self', username: 'tester', bio: 'Old bio', display_name: 'Tester', custom_status: 'Old text' };
  const guilds = new Map([['guild', { id: 'guild', name: 'Server', icon_path: 'self/original.png', owner_id: 'self', description: 'Old', discoverable: false, tags: [] }]]);
  const channels = new Map([['channel', { id: 'channel', name: 'general', kind: 'text', server_id: 'guild', no_images: false, read_only: false, slowmode: 0 }], ['other-channel', { id: 'other-channel', name: 'other', kind: 'text', server_id: 'other-guild' }], ['dm', { id: 'dm', kind: 'dm' }]]);
  const fetch = async (url, options) => {
    const call = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
    const custom = await handler(call); if (custom !== undefined) return custom;
    const route = call.url.pathname;
    if (route === '/auth/v1/user') return Response.json(session.user);
    if (route === '/rest/v1/rpc/bootstrap') return Response.json({ profiles: [profile, { id: 'other-user', username: 'other' }], servers: [...guilds.values()], channels: [...channels.values()].filter(c => c.server_id), dm_channels: [channels.get('dm')], members: { guild: [['self', 0]] } });
    if (route === '/rest/v1/profiles' && options.method === 'PATCH') return Response.json([Object.assign(profile, call.body)]);
    if (route === '/rest/v1/rpc/heartbeat') return new Response(null, { status: 204 });
    if (route === '/rest/v1/rpc/create_channel') { const row = { id: 'created-channel', name: call.body.channel_name, kind: call.body.channel_kind, server_id: call.body.sid }; channels.set(row.id, row); return Response.json(row.id); }
    if (route === '/rest/v1/rpc/create_server') { const row = { id: 'created-guild', name: call.body.server_name, icon_path: call.body.server_icon }; guilds.set(row.id, row); return Response.json(row.id); }
    if (route === '/rest/v1/channels') {
      const id = call.url.searchParams.get('id')?.slice(3), sid = call.url.searchParams.get('server_id')?.slice(3);
      const rows = [...channels.values()].filter(row => (!id || row.id === id) && (!sid || row.server_id === sid));
      if (options.method === 'PATCH') rows.forEach(row => Object.assign(row, call.body));
      if (options.method === 'DELETE') rows.forEach(row => channels.delete(row.id));
      return Response.json(rows);
    }
    if (route === '/rest/v1/servers') { const id = call.url.searchParams.get('id')?.slice(3); return Response.json([...guilds.values()].filter(row => !id || row.id === id)); }
    if (route === '/rest/v1/rpc/set_channel_posting') Object.assign(channels.get(call.body.cid), { read_only: call.body.make_read_only, slowmode: call.body.slow });
    if (route === '/rest/v1/rpc/set_channel_access') channels.get(call.body.cid).private = call.body.make_private;
    return new Response(null, { status: 204 });
  };
  const client = new Client({ apiKey: 'fake-public', fetch, realtime: false, autoRefresh: false, ...options });
  return { client, calls, channels, guilds };
}

test('ClientUser survives bootstrap and edits only its own profile', async () => {
  const { client, calls } = setup(); await client.login(session);
  assert.ok(client.user instanceof ClientUser); assert.equal(client.users.cache.get('self'), client.user);
  const updated = await client.user.edit({ bio: 'New bio', displayName: null, customStatus: 'Ready', pronouns: 'they/them', accentColor: '#aabbcc' });
  assert.equal(updated, client.user); assert.equal(client.user.bio, 'New bio'); assert.equal(client.user.displayName, null); assert.equal(client.user.customStatus, 'Ready');
  assert.deepEqual(calls.at(-1).body, { bio: 'New bio', display_name: null, pronouns: 'they/them', custom_status: 'Ready', accent_color: '#aabbcc' });
  assert.equal(calls.at(-1).url.searchParams.get('id'), 'eq.self'); assert.equal(client.users.cache.get('other-user').edit, undefined); client.destroy();
});
test('profile helpers validate limits and clear custom text', async () => {
  const { client, calls } = setup(); await client.login(session); const before = calls.length;
  await assert.rejects(client.user.setBio('x'.repeat(191)), RangeError);
  await assert.rejects(client.user.setUsername('bad name'), TypeError);
  await assert.rejects(client.user.setCustomStatus('x'.repeat(81)), RangeError);
  await assert.rejects(client.user.edit({ role: 'admin' }), TypeError);
  assert.equal(calls.length, before); await client.user.setCustomStatus(null); assert.equal(client.user.customStatus, null);
  await client.user.setUsername('new_name'); assert.equal(client.user.username, 'new_name'); client.destroy();
});
test('profile failure leaves cache and events unchanged', async () => {
  const { client } = setup(call => call.options.method === 'PATCH' ? Response.json({}, { status: 403 }) : undefined); await client.login(session);
  let updates = 0; client.on(Events.UserUpdate, () => updates++);
  await assert.rejects(client.user.setBio('forbidden'), YapperAPIError); assert.equal(client.user.bio, 'Old bio'); assert.equal(updates, 0); client.destroy();
});
test('presence and activity use the heartbeat protocol and offline clears server activity', async () => {
  const { client, calls } = setup(); await client.login(session);
  await client.user.setPresence({ status: 'dnd', activity: { name: 'Helping', since: 123 } });
  assert.deepEqual(calls.at(-1).body, { st: 'dnd', act: { name: 'Helping', since: 123 } }); assert.equal(client.presence.enabled, true);
  await client.user.setStatus('invisible'); assert.equal(calls.at(-1).body.st, 'invisible');
  await client.user.setStatus('offline'); assert.deepEqual(calls.at(-1).body, { st: 'off', act: null }); assert.equal(client.presence.enabled, false); client.destroy();
});
test('presence is opt-in, supports initial options and stops on destroy', async () => {
  const { client, calls } = setup(); await client.login(session); assert.ok(!calls.some(call => call.url.pathname.endsWith('/heartbeat'))); client.destroy();
  const second = setup(undefined, { presence: { status: 'idle', activity: 'Working' } }); await second.client.login(session);
  assert.equal(second.client.presence.status, 'idle'); assert.equal(second.client.presence.activity.name, 'Working');
  assert.equal(second.calls.at(-1).body.st, 'idle'); second.client.destroy(); assert.equal(second.client.presence.enabled, false);
  await assert.rejects(second.client.presence.heartbeat(), /Sign in/);
});
test('heartbeat errors preserve the previously accepted status', async () => {
  let fail = false; const { client } = setup(call => fail && call.url.pathname.endsWith('/heartbeat') ? Response.json({}, { status: 403 }) : undefined);
  await client.login(session); await client.user.setStatus('idle'); fail = true;
  await assert.rejects(client.user.setStatus('dnd'), YapperAPIError); assert.equal(client.presence.status, 'idle'); client.destroy();
});
test('presence updates are serialized and cancelled work cannot reenable timers', async () => {
  let resolve; const { client, calls } = setup(call => call.url.pathname.endsWith('/heartbeat') && call.body.st === 'idle' ? new Promise(done => { resolve = () => done(new Response(null, { status: 204 })); }) : undefined);
  await client.login(session); const a = client.user.setStatus('idle'), b = client.user.setStatus('dnd'); await tick();
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/heartbeat')).length, 1); resolve(); await Promise.all([a, b]); assert.equal(client.presence.status, 'dnd');
  const c = client.user.setStatus('idle'); await tick(); client.destroy(); resolve(); await assert.rejects(c, /cancelled/); assert.equal(client.presence.enabled, false);
});
test('invalid presence cannot reach the API', async () => {
  const { client, calls } = setup(); await client.login(session); const before = calls.length;
  assert.throws(() => client.user.setStatus('busy'), TypeError); assert.throws(() => client.user.setPresence({ status: 'idle', activities: [] }), TypeError);
  assert.throws(() => client.user.setActivity({ name: 'Thing', since: -1 }), TypeError); assert.equal(calls.length, before); client.destroy();
});
test('guild.channels creates typed channels and follows up with authoritative row', async () => {
  const { client, calls } = setup(); await client.login(session);
  const guild = client.guilds.cache.get('guild'), channel = await guild.channels.create({ name: 'Bot Logs', type: 'text' });
  assert.equal(channel.name, 'bot-logs'); assert.equal(channel.guild, guild); assert.equal(guild.channels.cache.get(channel.id), channel);
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/create_channel')).body, { sid: 'guild', channel_name: 'bot-logs', channel_kind: 'text' });
  await guild.channels.create({ name: 'Voice Chat', type: 'voice' }); assert.equal(calls.filter(call => call.url.pathname.endsWith('/create_channel')).at(-1).body.channel_name, 'Voice Chat'); client.destroy();
});
test('channel editing and deletion are scoped by server and update caches', async () => {
  const { client, calls } = setup(); await client.login(session); const channel = client.channels.cache.get('channel');
  await channel.edit({ name: 'New Name', noImages: true }); assert.equal(channel.name, 'new-name'); assert.equal(channel.noImages, true);
  assert.equal(calls.at(-1).url.searchParams.get('server_id'), 'eq.guild');
  await channel.delete(); assert.equal(client.channels.cache.has('channel'), false); assert.equal(calls.at(-1).options.method, 'DELETE'); client.destroy();
});
test('a failed or empty deletion response cannot evict the channel', async () => {
  const { client } = setup(call => call.options.method === 'DELETE' ? Response.json([]) : undefined); await client.login(session);
  await assert.rejects(client.channels.cache.get('channel').delete(), /not deleted/); assert.equal(client.channels.cache.has('channel'), true); client.destroy();
});
test('guild channel manager rejects cross-server changes and DM deletion', async () => {
  const { client, calls } = setup(); await client.login(session); const guild = client.guilds.cache.get('guild');
  await assert.rejects(guild.channels.delete('other-channel'), /not in this server/);
  await assert.rejects(client.channels.cache.get('dm').delete(), /DMs/);
  assert.ok(!calls.some(call => call.options.method === 'DELETE')); client.destroy();
});
test('channel posting/access use verified RPC argument names and reload state', async () => {
  const { client, calls } = setup(); await client.login(session); const channel = client.channels.cache.get('channel');
  await channel.setPosting({ readOnly: true, roleIds: ['role'], slowmode: 10 });
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/set_channel_posting')).body, { cid: 'channel', make_read_only: true, post_role_ids: ['role'], slow: 10 });
  assert.equal(channel.readOnly, true); assert.equal(channel.slowmode, 10);
  await channel.setAccess({ private: true, roleIds: ['role'] }); assert.equal(channel.private, true);
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/set_channel_access')).body, { cid: 'channel', make_private: true, role_ids: ['role'] }); client.destroy();
});
test('channel reorder validates membership and positions', async () => {
  const { client, calls } = setup(); await client.login(session); const channels = client.guilds.cache.get('guild').channels;
  await channels.setPositions(['channel']); assert.equal(channels.cache.get('channel').position, 0);
  const before = calls.filter(call => call.url.pathname.endsWith('/reorder_channels')).length;
  await assert.rejects(channels.setPositions(['channel', 'channel']), /unique/); await assert.rejects(channels.setPositions(['other-channel']), /outside/);
  assert.equal(calls.filter(call => call.url.pathname.endsWith('/reorder_channels')).length, before); client.destroy();
});
test('server creation and renaming preserve unspecified icon', async () => {
  const { client, calls } = setup(); await client.login(session); const guild = await client.guilds.create({ name: 'New Server' }); assert.equal(guild.name, 'New Server');
  await client.guilds.cache.get('guild').setName('Renamed');
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/update_server')).body, { sid: 'guild', server_name: 'Renamed', server_icon: 'self/original.png' });
  assert.equal(client.guilds.cache.get('guild').name, 'Renamed'); client.destroy();
});
test('discovery settings preserve visibility and tags; nickname uses the verified RPC', async () => {
  const { client, calls } = setup(); await client.login(session); const guild = client.guilds.cache.get('guild');
  await guild.setDiscovery({ description: 'New description' });
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/set_server_discovery')).body, { sid: 'guild', p_on: false, p_description: 'New description', p_tags: [] });
  await guild.setNickname(client.user, 'Helper'); assert.deepEqual(calls.at(-1).body, { sid: 'guild', target: 'self', nick: 'Helper' }); client.destroy();
});
test('server deletion purges only its channels and members after success', async () => {
  const { client, calls } = setup(); await client.login(session); await client.guilds.cache.get('guild').delete();
  assert.deepEqual(calls.at(-1).body, { sid: 'guild' }); assert.equal(client.guilds.cache.has('guild'), false); assert.equal(client.channels.cache.has('channel'), false);
  assert.equal(client.channels.cache.has('other-channel'), true); assert.equal(client.channels.cache.has('dm'), true); assert.equal(client._members.guild, undefined); client.destroy();
});
test('denied server operations leave caches intact', async () => {
  const { client } = setup(call => call.url.pathname.endsWith('/delete_server') ? Response.json({}, { status: 403 }) : undefined); await client.login(session);
  await assert.rejects(client.guilds.cache.get('guild').delete(), YapperAPIError); assert.equal(client.guilds.cache.has('guild'), true); assert.equal(client.channels.cache.has('channel'), true); client.destroy();
});

test('presence heartbeat renews on schedule and destroy cancels renewal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, calls } = setup();
  try {
    await client.login(session); await client.user.setStatus('online');
    assert.equal(calls.filter(call => call.url.pathname.endsWith('/heartbeat')).length, 1);
    t.mock.timers.tick(45000); await tick();
    assert.equal(calls.filter(call => call.url.pathname.endsWith('/heartbeat')).length, 2);
    client.destroy(); t.mock.timers.tick(45000); await tick();
    assert.equal(calls.filter(call => call.url.pathname.endsWith('/heartbeat')).length, 2);
  } finally { client.destroy(); t.mock.timers.reset(); }
});
