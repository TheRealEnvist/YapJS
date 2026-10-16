'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Client, Events, ReactionButtonBuilder, ReactionMenu, parseArguments, CollectorError } = require('../YapperJS');
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_at: 4102444800, user: { id: 'self', user_metadata: { username: 'bot' } } };
function setup(handler = () => undefined, extra = {}) {
  const calls = [], reactionRows = new Map(), messageRows = new Map(); let sequence = 0;
  const fetch = async (url, options) => {
    const call = { url: new URL(url), options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
    const custom = await handler(call); if (custom !== undefined) return custom;
    const route = call.url.pathname;
    if (route.endsWith('/auth/v1/user')) return Response.json(session.user);
    if (route.endsWith('/rpc/bootstrap')) return Response.json({ profiles: [{ id: 'self', username: 'bot' }, { id: 'alice', username: 'Alice' }, { id: 'bob', username: 'Bob' }], servers: [{ id: 'guild', name: 'Test' }], channels: [{ id: 'channel', kind: 'text', name: 'general', server_id: 'guild' }], dm_channels: [{ id: 'dm', kind: 'dm' }], dm_members: [['dm', 'self'], ['dm', 'alice']] });
    if (route.endsWith('/messages')) {
      const id = call.url.searchParams.get('id')?.slice(3);
      if (options.method === 'POST') { const row = { ...call.body, id: `m${++sequence}`, created_at: new Date().toISOString() }; messageRows.set(row.id, row); return Response.json([row]); }
      if (options.method === 'PATCH') { const row = messageRows.get(id); if (!row) return Response.json([]); Object.assign(row, call.body); return Response.json([row]); }
      return Response.json([...messageRows.values()].filter(row => !id || row.id === id));
    }
    if (route.endsWith('/reactions')) {
      if (options.method === 'POST') { const row = { ...call.body, id: `r${++sequence}` }; reactionRows.set(row.id, row); return Response.json([row]); }
      const filter = [...call.url.searchParams.entries()].filter(([key]) => key !== 'select');
      const rows = [...reactionRows.values()].filter(row => filter.every(([key, value]) => row[key] === value.slice(3)));
      if (options.method === 'DELETE') rows.forEach(row => reactionRows.delete(row.id)); return Response.json(rows);
    }
    return new Response(null, { status: 204 });
  };
  const client = new Client({ apiKey: 'fake-public', fetch, autoRefresh: false, realtime: false, ...extra });
  const incoming = (content, authorId = 'alice', channelId = 'channel') => {
    const id = `incoming-${++sequence}`, row = { id, channel_id: channelId, author_id: authorId, content }; messageRows.set(id, row);
    return client._messageManager(channelId)._add(row);
  };
  const react = (message, emoji, userId = 'alice', id = `event-${++sequence}`) => {
    const row = { id, message_id: message.id, user_id: userId, emoji }; reactionRows.set(id, row); client._dispatch('reaction', { table: 'reactions', operation: 'INSERT', record: row }); return row;
  };
  const unreact = row => { reactionRows.delete(row.id); client._dispatch('reaction', { table: 'reactions', operation: 'DELETE', old_record: { id: row.id } }); };
  return { client, calls, incoming, react, unreact, reactionRows, messageRows };
}

test('argument parser handles quotes, escaped spaces and empty arguments', () => {
  assert.deepEqual(parseArguments('one "two three" \'four five\' six\\ seven ""'), ['one', 'two three', 'four five', 'six seven', '']);
  assert.throws(() => parseArguments('"unfinished'), /Unclosed/);
});
test('commands resolve aliases, preserve raw arguments and reject duplicate names', async () => {
  const { client, incoming } = setup(); await client.login(session); let seen;
  client.commands.register({ name: 'greet', aliases: ['hi'], execute: ctx => { seen = { args: ctx.args, raw: ctx.rawArgs, author: ctx.authorId, prefix: ctx.prefix }; } });
  assert.equal(await client.commands.handle(incoming('!HI "two words" one')), true);
  assert.deepEqual(seen, { args: ['two words', 'one'], raw: '"two words" one', author: 'alice', prefix: '!' });
  assert.throws(() => client.commands.register({ name: 'hi', execute() {} }), /already registered/);
  assert.equal(client.commands.unregister('hi'), true); assert.equal(client.commands.resolve('greet'), null); client.destroy();
});
test('owner checks, guild checks, argument counts and async authorization prevent execution', async () => {
  const { client, incoming } = setup(undefined, { commands: { owners: ['alice'] } }); await client.login(session); let executions = 0; const reasons = [];
  client.on(Events.CommandRejected, (_, data) => reasons.push(data.reason));
  client.commands.register({ name: 'admin', ownerOnly: true, guildOnly: true, minArgs: 1, execute() { executions++; } });
  await client.commands.handle(incoming('!admin yes', 'bob')); await client.commands.handle(incoming('!admin yes', 'alice', 'dm')); await client.commands.handle(incoming('!admin', 'alice'));
  client.commands.register({ name: 'denied', authorize: async () => false, execute() { executions++; } }); await client.commands.handle(incoming('!denied'));
  assert.deepEqual(reasons, ['ownerOnly', 'guildOnly', 'args', 'authorization']); assert.equal(executions, 0); client.destroy();
});
test('cooldowns are per command and author, even for simultaneous invocations', async () => {
  const { client, incoming } = setup(); await client.login(session); let executions = 0;
  client.commands.register({ name: 'limited', cooldown: 10000, execute: async () => { executions++; await tick(); } });
  await Promise.all([client.commands.handle(incoming('!limited')), client.commands.handle(incoming('!limited'))]);
  assert.equal(executions, 1); await client.commands.handle(incoming('!limited', 'bob')); assert.equal(executions, 2); client.destroy();
});
test('automatic command routing ignores own messages and catches command errors', async () => {
  const { client, incoming } = setup(); await client.login(session); let executions = 0, error;
  client.commands.register({ name: 'run', execute() { executions++; } });
  client._dispatch('message', { table: 'messages', operation: 'INSERT', record: { id: 'command', channel_id: 'channel', author_id: 'alice', content: '!run' } }); await tick(); assert.equal(executions, 1);
  await client.commands.handle(incoming('!run', 'self')); assert.equal(executions, 1);
  client.on(Events.CommandError, value => { error = value; }); client.commands.register({ name: 'fail', execute() { throw new Error('fake-secret'); } });
  await client.commands.handle(incoming('!fail')); assert.equal(error.code, 'COMMAND_FAILED'); assert.ok(!error.message.includes('fake-secret')); client.destroy();
});
test('help hides owner-only commands and command files load from a directory', async () => {
  const { client, incoming, calls } = setup(); await client.login(session); const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yapper-command-'));
  try {
    await fs.writeFile(path.join(directory, 'test.js'), "module.exports = { name: 'loaded', description: 'Loaded command', execute() {} };\n");
    client.commands.load(directory).register({ name: 'secret', ownerOnly: true, execute() {} }).addHelpCommand();
    await client.commands.handle(incoming('!help')); const body = calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/messages')).at(-1).body;
    assert.ok(body.content.includes('!loaded')); assert.ok(!body.content.includes('!secret'));
  } finally { client.destroy(); await fs.rm(directory, { recursive: true, force: true }); }
});
test('reaction writes use observed schema, merge duplicate calls and scope deletion to self', async () => {
  const { client, calls } = setup(); await client.login(session); const message = await client.channels.cache.get('channel').send('Hello');
  const [a, b] = await Promise.all([message.react('✅'), message.react('✅')]); assert.equal(a, b); assert.equal(a.count, 1); assert.equal(a.me, true);
  const writes = calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/reactions')); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { message_id: message.id, user_id: 'self', emoji: '✅' });
  await a.remove(); const deletion = calls.at(-1); assert.equal(deletion.url.searchParams.get('user_id'), 'eq.self'); assert.equal(message.reactions.cache.size, 0); client.destroy();
});
test('live reaction events deduplicate and resolve ID-only removals', async () => {
  const { client, incoming, react, unreact } = setup(); await client.login(session); const message = incoming('React here'); let adds = 0, removals = 0;
  client.on(Events.MessageReactionAdd, (reaction, user) => { adds++; assert.equal(reaction.message, message); assert.equal(user.id, 'alice'); });
  client.on(Events.MessageReactionRemove, () => removals++);
  const row = react(message, '✅'); client._dispatch('reaction', { table: 'reactions', operation: 'INSERT', record: row }); assert.equal(adds, 1);
  unreact(row); unreact(row); assert.equal(removals, 1); assert.equal(message.reactions.cache.has('✅'), false); client.destroy();
});
test('uncached message reactions expose a partial that can be fetched without losing reactions', async () => {
  const { client, messageRows, react } = setup(); await client.login(session); let reaction;
  messageRows.set('unknown', { id: 'unknown', channel_id: 'channel', content: 'Fetched', author_id: 'alice' });
  client.once(Events.MessageReactionAdd, value => { reaction = value; }); react({ id: 'unknown' }, '🔥');
  assert.equal(reaction.message.partial, true); const fetched = await reaction.message.fetch(); assert.equal(fetched.partial, false); assert.equal(fetched.reactions.cache.get('🔥').count, 1); client.destroy();
});
test('message collectors scope channels, await async filters, and stop at limits', async () => {
  const { client, incoming } = setup(); await client.login(session); const collector = client.channels.cache.get('channel').createMessageCollector({ max: 1, filter: async message => message.authorId === 'alice' });
  client.emit(Events.MessageCreate, incoming('wrong channel', 'alice', 'dm')); client.emit(Events.MessageCreate, incoming('wrong user', 'bob')); client.emit(Events.MessageCreate, incoming('accepted'));
  const { collected, reason } = await collector.finished; assert.equal(reason, 'limit'); assert.equal(collected.first().content, 'accepted'); assert.equal(client._collectorHub.active.size, 0); client.destroy();
});
test('collector deadlines reject await helpers and clean up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const { client } = setup();
  try {
    await client.login(session); const pending = client.channels.cache.get('channel').awaitMessages({ time: 100, errors: ['time'] });
    const rejection = assert.rejects(pending, error => error instanceof CollectorError && error.reason === 'time'); t.mock.timers.tick(100); await rejection;
    assert.equal(client._collectorHub.active.size, 0);
  } finally { client.destroy(); t.mock.timers.reset(); }
});
test('collectors shut down on deletion and use one client listener per event', async () => {
  const { client, incoming } = setup(); await client.login(session); const message = incoming('Menu');
  const before = client.listenerCount(Events.MessageReactionAdd); const collectors = Array.from({ length: 25 }, () => message.createReactionCollector());
  assert.equal(client.listenerCount(Events.MessageReactionAdd), before); client.emit(Events.MessageDelete, message);
  assert.ok(collectors.every(collector => collector.ended && collector.endReason === 'messageDelete')); assert.equal(client._collectorHub.active.size, 0); client.destroy();
});
test('destroy while a filter awaits cannot collect afterward', async () => {
  const { client, incoming } = setup(); await client.login(session); let resolve;
  const collector = client.channels.cache.get('channel').createMessageCollector({ filter: () => new Promise(done => { resolve = done; }) });
  client.emit(Events.MessageCreate, incoming('test')); await tick(); client.destroy(); resolve(true); await tick(); assert.equal(collector.collected.size, 0); assert.equal(collector.endReason, 'clientDestroy');
});
test('menus reject unrestricted audiences and invalid options before posting', async () => {
  const { client, calls } = setup(); await client.login(session); const channel = client.channels.cache.get('channel'); const before = calls.length;
  const buttons = [new ReactionButtonBuilder().setCustomId('yes').setLabel('Yes').setEmoji('✅')];
  await assert.rejects(channel.sendReactionMenu({ content: 'Pick', buttons }), /allowedUserIds/);
  await assert.rejects(channel.sendReactionMenu({ content: 'Pick', buttons, allowedUserIds: ['alice'], time: 0 }), /positive/); assert.equal(calls.length, before); client.destroy();
});
test('reaction buttons enforce audience and disabled states and only invoke once', async () => {
  const { client, react } = setup(); await client.login(session); let calls = 0;
  const menu = await client.channels.cache.get('channel').sendReactionMenu({ content: 'Choose', allowedUserIds: ['alice'], once: true,
    buttons: [{ customId: 'yes', label: 'Yes', emoji: '✅' }, { customId: 'no', label: 'No', emoji: '❌', disabled: true }], onSelect: async interaction => { assert.equal(interaction.customId, 'yes'); calls++; await tick(); } });
  react(menu.message, '✅', 'bob'); react(menu.message, '❌'); react(menu.message, '✅'); react(menu.message, '✅');
  const { reason } = await menu.finished; assert.equal(reason, 'selected'); assert.equal(calls, 1); client.destroy();
});
test('confirmation returns false on timeout and true only on an allowed confirm', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const { client, react } = setup();
  try {
    await client.login(session); const channel = client.channels.cache.get('channel'); const pending = channel.confirm({ content: 'Continue?', allowedUserIds: ['alice'], time: 100 }); await tick();
    const message = channel.messages.cache.last(); react(message, '✅'); assert.equal((await pending).confirmed, true);
    const timeout = channel.confirm({ content: 'Again?', allowedUserIds: ['alice'], time: 100 }); await tick(); t.mock.timers.tick(100); assert.equal((await timeout).confirmed, false);
  } finally { client.destroy(); t.mock.timers.reset(); }
});
test('pagination serializes navigation, clamps bounds and closes', async () => {
  const { client, react } = setup(); await client.login(session); const menu = await client.channels.cache.get('channel').paginate(['First', 'Second'], { allowedUserIds: ['alice'] });
  react(menu.message, '➡️'); await tick(); assert.ok(menu.message.content.startsWith('Second'));
  react(menu.message, '➡️'); await tick(); assert.ok(menu.message.content.includes('Page 2/2'));
  react(menu.message, '⬅️'); await tick(); assert.ok(menu.message.content.startsWith('First'));
  react(menu.message, '⏹️'); assert.equal((await menu.finished).reason, 'closed'); client.destroy();
});

test('pagination edit denial keeps the original message and preserves safe API diagnostics', async t => {
  const errors = [];
  const { client, react, calls } = setup(call => call.options.method === 'PATCH'
    ? Response.json({ code: '42501', message: 'private-server-detail' }, { status: 403 }) : undefined);
  t.after(() => client.destroy());
  client.on(Events.Error, error => errors.push(error));
  await client.login(session);
  const menu = await client.channels.cache.get('channel').paginate(['First', 'Second'], { allowedUserIds: ['alice'] });
  react(menu.message, '\u27a1\ufe0f');
  assert.equal((await menu.finished).reason, 'error');
  assert.equal(menu.message.content.startsWith('First'), true);
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/messages')).length, 1);
  assert.equal(errors[0].request.status, 403);
  assert.equal(errors[0].request.route, '/rest/v1/messages');
  assert.equal(errors[0].request.code, '42501');
  assert.doesNotMatch(errors[0].message + JSON.stringify(errors[0]), /private-server-detail/);
});
test('polls count one current vote per user and process removals', async () => {
  const { client, react, unreact } = setup(); await client.login(session); const poll = await client.channels.cache.get('channel').createPoll({ question: 'Pick one', choices: ['A', 'B'], updateOnEnd: false });
  react(poll.message, '1️⃣'); const second = react(poll.message, '2️⃣'); react(poll.message, '1️⃣', 'bob'); await tick();
  assert.deepEqual(poll.results().map(choice => choice.votes), [1, 1]); unreact(second); await tick(); assert.deepEqual(poll.results().map(choice => choice.votes), [1, 0]);
  poll.stop(); const result = await poll.finished; assert.equal(result.results[0].votes, 1); client.destroy();
});
test('reaction role configuration uses verified pairs and seeds own reactions', async () => {
  const { client, calls, incoming } = setup(); await client.login(session); const message = incoming('Get a role');
  await message.setReactionRoles([{ emoji: '✅', roleId: 'role' }]); assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/set_reaction_roles')).body, { mid: message.id, pairs: [{ emoji: '✅', role_id: 'role' }] }); client.destroy();
});

test('bundled commands load and dispatch through the real router', async () => {
  const { client, calls, incoming } = setup(); await client.login(session);
  client.commands.load(path.join(__dirname, '../examples/bot/commands')).addHelpCommand();
  for (const name of ['ping', 'help', 'avatar', 'userinfo', 'serverinfo', 'menu', 'pages', 'confirm', 'poll', 'ask']) assert.ok(client.commands.resolve(name));
  await client.commands.handle(incoming('!ping'));
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/messages')).at(-1).body.content, 'Pong!');
  await client.commands.handle(incoming('!menu'));
  assert.equal(client._collectorHub.active.size, 1); client.destroy(); assert.equal(client._collectorHub.active.size, 0);
});
test('ask command receives only the requesting user in the originating channel', async () => {
  const { client, incoming, calls } = setup(); await client.login(session); client.commands.load(path.join(__dirname, '../examples/bot/commands'));
  const pending = client.commands.handle(incoming('!ask')); await tick();
  client.emit(Events.MessageCreate, incoming('wrong user', 'bob')); client.emit(Events.MessageCreate, incoming('My reply'));
  assert.equal(await pending, true);
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.pathname.endsWith('/messages')).at(-1).body.content, 'You said: My reply'); client.destroy();
});
test('reaction duplicate conflicts recover by fetching the existing own row', async () => {
  const { client, incoming, reactionRows } = setup(call => call.options.method === 'POST' && call.url.pathname.endsWith('/reactions') ? Response.json({ code: '23505' }, { status: 409 }) : undefined);
  await client.login(session); const message = incoming('Test'); reactionRows.set('existing', { id: 'existing', message_id: message.id, user_id: 'self', emoji: '✅' });
  const reaction = await message.react('✅'); assert.equal(reaction.me, true); assert.equal(reaction.count, 1); client.destroy();
});
test('reaction seeding failure stops menu collectors', async () => {
  const { client } = setup(call => call.options.method === 'POST' && call.url.pathname.endsWith('/reactions') ? Response.json({}, { status: 403 }) : undefined);
  await client.login(session);
  await assert.rejects(client.channels.cache.get('channel').sendReactionMenu({ content: 'Fail', allowedUserIds: ['alice'], buttons: [{ customId: 'yes', label: 'Yes', emoji: '✅' }] }));
  assert.equal(client._collectorHub.active.size, 0); client.destroy();
});
