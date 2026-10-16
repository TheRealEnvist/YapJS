# YapperJS compatibility package

This directory contains the library implementation and can still be installed
or packed directly. The repository root is the canonical package and includes
the maintained developer guides under `docs/`.

In a source checkout, start with the [documentation index](../docs/README.md),
[API reference](../docs/api.md), and [root README](../README.md). A package made
directly from this directory contains the library and this quick reference;
install the root package to get the complete guides with your dependency.

## Requirements and imports

Node.js 22 or newer is required. There are no runtime dependencies. CommonJS
and native ESM expose the same named exports, with TypeScript declarations in
[index.d.ts](index.d.ts).

```js
const { Client, Events, FileSessionStore } = require('yapperjs');
// In an ES module:
// import { Client, Events, FileSessionStore } from 'yapperjs';
```

Importing the library does not load `.env`, register bot commands, start a
heartbeat, or connect. Create a client and call `login()` explicitly.

## Minimal application

The following is a CommonJS example for a consuming project. It requires an
independent authorized session on first use; later runs restore its stored pair.

```js
const path = require('node:path');
const { Client, Events, FileSessionStore } = require('yapperjs');
const store = new FileSessionStore(path.join(__dirname, '.data/session.json'));
const client = new Client({ sessionStore: store, presence: { status: 'online' } });

client.on(Events.Error, error => console.error(error.message));
client.once(Events.ClientReady, ready => console.log(`Ready as ${ready.user.username}`));
client.commands.register({
  name: 'ping',
  async execute(ctx) { await ctx.reply('Pong!'); },
});
process.once('SIGINT', () => client.destroy());
process.once('SIGTERM', () => client.destroy());

async function main() {
  const saved = await store.load();
  const initial = process.env.YAPPER_SESSION || process.env.YAPPER_VALUE;
  await client.login(saved ?? initial);
}
main().catch(error => { console.error(error.message); client.destroy(); process.exitCode = 1; });
```

Load environment values explicitly, for example with `node --env-file=.env bot.cjs`.
Presence is opt-in for a bare Client; configured online presence renews every 45
seconds by default. `destroy()` stops local connections/timers and leaves the
saved session intact. Do not run separate clients against the same refresh-token
chain.

## Runtime boundaries

Messages support plain text and `{ content, replyTo }`. Reactions, collectors,
menus, confirmation, pagination, polls, DMs, profile customization, and server
management have dedicated helpers in the API. Slash commands, native buttons,
rich embeds, file uploads, and full discord.js compatibility are not implemented.

Yapper enforces API permissions and limits. Pagination edits one message and
stops if an update fails. See the main package's troubleshooting guide for
authentication, permissions, and connection errors.

The maintained troubleshooting, configuration, authentication, and interaction
guides are in the canonical root package's `docs/` directory.
