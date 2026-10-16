# YapJS

An unofficial Node.js library for building Yapper bots. YapJS handles
authentication, realtime events, messages, commands, reactions, and server
management through a discord.js-style API.

Requires **Node.js 22 or newer**. Supports CommonJS, native ESM, and TypeScript,
with no runtime dependencies. Licensed under MIT.

## Install

For a published npm release:

```sh
npm install @therealenvist/yapjs
```

If the package has not been published under that name yet, install the repository
root from a local checkout instead: `npm install /absolute/path/to/YapJS`.
See [installation options](docs/getting-started.md#install) for Git and tarball installs.

```js
const { Client, Events, FileSessionStore } = require('@therealenvist/yapjs');
// ESM: import { Client, Events, FileSessionStore } from '@therealenvist/yapjs';
```

## Create your first bot

### 1. Get your session

Sign in to the bot's account on the Yapper website. Open browser developer tools,
select **Application → Local Storage** (Chrome/Edge), and copy the entire value
of **`yp:1n00fw`**. This is the account's encoded session.
See [the token walkthrough](docs/authentication.md#find-your-bot-token-in-the-browser)
for detailed steps.

In your own bot project, create `.env`:

```dotenv
YAPPER_VALUE='PASTE_YOUR_ENCODED_SESSION_HERE'
```

Keep `.env` and `.data/` out of source control. Close the bot account's Yapper
browser tabs before using that session in the bot.

### 2. Write `bot.cjs`

```js
const path = require('node:path');
const { Client, Events, FileSessionStore } = require('@therealenvist/yapjs');

const store = new FileSessionStore(path.join(__dirname, '.data/session.json'));
const client = new Client({
  sessionStore: store,
  presence: { status: 'online' },
  commands: { prefix: '!', replyOnReject: true },
});

client.on(Events.Error, error => console.error(error.message));
client.once(Events.ClientReady, ready => {
  console.log(`Ready as ${ready.user.username || ready.userId}`);
});

client.commands.register({
  name: 'ping',
  description: 'Check whether the bot responds',
  async execute(ctx) { await ctx.reply('Pong!'); },
});
client.commands.addHelpCommand();

process.once('SIGINT', () => client.destroy());
process.once('SIGTERM', () => client.destroy());

async function main() {
  const saved = await store.load();
  const initial = process.env.YAPPER_SESSION || process.env.YAPPER_VALUE;
  if (!saved && !initial) throw new Error('Set YAPPER_VALUE in .env for the first login.');
  await client.login(saved ?? initial);
}

main().catch(error => {
  console.error(error.message);
  client.destroy();
  process.exitCode = 1;
});
```

### 3. Run it

```sh
node --env-file=.env bot.cjs
```

Once it prints `Ready as ...`, send `!ping` from another account in a channel the
bot can access, or in a DM. It replies `Pong!`; `!help` lists your commands.

The file store saves the current session on login and refresh. After the first
successful run, remove the initial value from `.env` and keep the file for any
other settings. Restarts use the saved session. The configured online presence
renews every 45 seconds by default. Ctrl+C stops connections and timers.

For project setup, ESM, and TypeScript, follow [Getting started](docs/getting-started.md).

For a complete welcome bot, FAQs, private help, polls, announcements, and avatar
commands, see [Common bot recipes](docs/bot-recipes.md).

## Use the package

The following snippets assume your `client` has logged in. Run `await` inside
an async function or an ES module.

### Send messages and DMs

```js
const channel = await client.channels.fetch('CHANNEL_ID');
if (!channel) throw new Error('Channel unavailable.');

const sent = await channel.send('Hello from YapJS!');
await sent.reply('A reply to that message.');
await client.sendDM('USER_ID', 'Hello privately!');

const recent = await channel.messages.fetch({ limit: 20 });
console.log(recent.map(message => message.content));
```

Messages also support `edit()`, `delete()`, and `react()`. Yapper checks the bot
account's permissions for each operation. See [Messaging and history](docs/api.md#messages-and-message-history).

### Handle incoming events

```js
client.on(Events.MessageCreate, async message => {
  if (message.authorId === client.userId) return;
  if (message.content === 'hello') await message.reply('Hi!');
});
```

Register listeners before `login()` to handle the first incoming events.
The same event handles server messages and DMs. Use
`message.channel?.isDMBased()` to check the context.

### Add commands and interactive messages

Register text commands through `client.commands.register()`. You control their
names, aliases, arguments, cooldowns, and access checks. The package starts with
an empty router; the starter above adds `ping` and `help`.

Channels provide `confirm()`, `paginate()`, `createPoll()`, and
`sendReactionMenu()`. These use emoji reactions as controls. Pagination edits
one message, so it requires permission to edit that message.

## Documentation

Start with [Getting started](docs/getting-started.md), or browse the
[documentation index](docs/README.md).

| Guide | What you will learn |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install the package and build your own bot |
| [Common bot recipes](docs/bot-recipes.md) | Build a welcome bot, FAQs, private help, polls, and announcements |
| [Authentication](docs/authentication.md) | Find a session, save it, and handle token refresh |
| [Configuration](docs/configuration.md) | Client options, command defaults, and online heartbeat |
| [API reference](docs/api.md) | Clients, users, channels, messages, servers, and managers |
| [Commands and events](docs/commands-and-events.md) | Route commands, authorize users, and handle realtime events |
| [Interactions](docs/interactions.md) | Reactions, collectors, menus, confirmations, pages, and polls |
| [Customization and moderation](docs/customization-and-moderation.md) | Profiles, channels, servers, members, and roles |
| [Troubleshooting](docs/troubleshooting.md) | Diagnose authentication, permission, and connection failures |

The Markdown guides are included in the package under `docs/`. TypeScript
declarations are included; no separate `@types` package is needed.

## Scope and support

YapJS supports plain-text messaging, replies, history, DMs, reactions,
collectors, command routing, presence, profile changes, and server management.
File uploads, rich embeds, native slash commands, voice, and full discord.js
compatibility are not implemented. Yapper enforces permissions and API limits;
realtime delivery is best-effort. See [capabilities and limits](docs/README.md#capabilities-and-limits).

For an API failure, check [Troubleshooting](docs/troubleshooting.md) and include
the sanitized error in an [issue](https://github.com/TheRealEnvist/YapJS/issues).

## Repository examples and contributing

The source repository includes optional runnable bots. See
[Repository examples](docs/examples.md) to try them, and
[Contributing](docs/contributing.md) for tests and package checks.
