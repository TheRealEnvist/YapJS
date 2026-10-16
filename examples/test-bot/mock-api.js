'use strict';
const { Message } = require('yapjs');

// An in-memory API for the demo and tests. Every request stays in this process;
// unsupported routes fail instead of falling back to the real Yapper API.
function createMockAPI({ onRequest } = {}) {
  const profiles = [{ id: 'demo-bot', username: 'TestBot', is_bot: true }, { id: 'demo-user', username: 'Tester', display_name: 'Demo Tester', bio: 'Testing YapJS', avatar_path: 'demo-user/avatar.png' }];
  const channel = { id: 'demo-channel', name: 'bot-testing', kind: 'text', server_id: 'demo-server' };
  const dm = { id: 'demo-dm', kind: 'dm' };
  const messages = new Map(), reactions = new Map(), calls = [];
  let sequence = 0;
  const session = {
    access_token: 'fake-demo-access', refresh_token: 'fake-demo-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'demo-bot', user_metadata: { username: 'TestBot' } },
  };
  const fetch = async (input, options) => {
    const url = new URL(input), body = options.body ? JSON.parse(options.body) : undefined;
    const call = { url, method: options.method, body }; calls.push(call);
    const override = await onRequest?.(call);
    if (override !== undefined) return override;
    const route = url.pathname;
    if (route === '/auth/v1/user') return Response.json(session.user);
    if (route === '/rest/v1/rpc/heartbeat') return new Response(null, { status: 204 });
    if (route === '/rest/v1/rpc/bootstrap') return Response.json({
      profiles, servers: [{ id: 'demo-server', name: 'Test Server' }], channels: [channel],
      members: { 'demo-server': [['demo-bot', 0], ['demo-user', 0]] },
    });
    if (route === '/rest/v1/profiles') {
      const fields = (url.searchParams.get('select') || '*').split(',');
      if (fields.includes('*') || fields.includes('is_bot')) return Response.json({ code: '42501', message: 'permission denied for table profiles' }, { status: 403 });
      const rows = profiles.filter(row => !url.searchParams.has('id') || url.searchParams.get('id') === `eq.${row.id}`);
      if (options.method === 'PATCH') rows.forEach(row => Object.assign(row, body));
      return Response.json(rows.map(row => Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]]))));
    }
    if (route === '/rest/v1/rpc/get_or_create_dm' && body.other === 'demo-user') return Response.json(dm.id);
    if (route === '/rest/v1/channels') return Response.json([channel, dm].filter(row => url.searchParams.get('id') === `eq.${row.id}`));
    if (route === '/rest/v1/messages') {
      if (options.method === 'POST') {
        const row = { ...body, created_at: new Date().toISOString(), edited_at: null };
        messages.set(row.id, row); return Response.json([row]);
      }
      const rows = [...messages.values()].filter(row => ['id', 'channel_id'].every(key => !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${row[key]}`));
      if (options.method === 'PATCH') {
        for (const row of rows) Object.assign(row, body, { edited_at: new Date().toISOString() });
        return Response.json(rows);
      }
      if (options.method === 'GET') return Response.json(rows);
    }
    if (route === '/rest/v1/reactions' && options.method === 'POST') {
      const row = { ...body, id: `reaction-${++sequence}` };
      reactions.set(row.id, row); return Response.json([row]);
    }
    throw new Error(`Unsupported demo request: ${options.method} ${route}`);
  };
  const incoming = (client, content, { authorId = 'demo-user', channelId = channel.id } = {}) => new Message(client, {
    id: `incoming-${++sequence}`, channel_id: channelId, author_id: authorId, content,
  });
  const react = (client, message, emoji, userId = 'demo-user') => {
    const row = { id: `reaction-${++sequence}`, message_id: message.id, user_id: userId, emoji };
    reactions.set(row.id, row);
    client._dispatch('reaction', { table: 'reactions', operation: 'INSERT', record: row });
    return row;
  };
  const unreact = (client, row) => {
    reactions.delete(row.id);
    client._dispatch('reaction', { table: 'reactions', operation: 'DELETE', old_record: { ...row } });
  };
  return { fetch, session, incoming, react, unreact, calls, messages, reactions, profiles };
}

module.exports = { createMockAPI };
