# Getting started

[Documentation index](README.md)

This guide builds a bot in **your own project** using the YapperJS package.
By the end, your bot will log in, stay online, and answer `!ping` and `!help` in
server channels and DMs.

## Requirements

- Node.js **22 or newer** and npm.
- A Yapper account to run as the bot, with access to the channels you want to use.
- Another account to send commands to it; the router ignores its own messages.

YapperJS has no runtime dependencies. In PowerShell, use `npm.cmd` in place of
`npm` if your execution policy blocks `npm.ps1`.

## Install

Create a project folder and initialize it:

```sh
mkdir my-yapper-bot
cd my-yapper-bot
npm init -y
```

Install a published release:

```sh
npm install yapperjs
```

If the package is not published under that name yet, choose one of these sources
instead. Run the install command from **your bot project's folder**:

| Source | Command | Requirement |
| --- | --- | --- |
| Local checkout | `npm install /absolute/path/to/YapperJS` | Point to the repository root, which contains `package.json` and `docs/` |
| Package archive | `npm install ./yapperjs-0.7.0.tgz` | Obtain an archive created with `npm pack`; use its actual filename |
| GitHub | `npm install github:TheRealEnvist/YapperJS` | The desired version must be pushed; append `#TAG_OR_COMMIT` to pin it |

The examples below import `yapperjs`, the package name in this repository. If a
release uses a scoped name, use that name in both the install command and imports.

## Get a session

Sign in to the bot's account in a browser. Open developer tools, select
**Application → Local Storage** (Chrome/Edge) or **Storage → Local Storage**
(Firefox), and copy the complete **Value** of **`yp:1n00fw`** for the Yapper site.

Create `.env` in your bot project:

```dotenv
YAPPER_VALUE='PASTE_THE_COMPLETE_yp:1n00fw_VALUE_HERE'
```

This is an encoded account session. Keep it private, and close that account's
Yapper browser tabs before starting the bot with it. The
[authentication walkthrough](authentication.md#find-your-bot-token-in-the-browser)
has detailed steps and alternative session formats.

Create `.gitignore` in the same project:

```gitignore
node_modules/
.env
.data/
```

Your application will save refreshed credentials in `.data/session.json`.

## Complete CommonJS starter

Save this as **`bot.cjs`** next to your project's `package.json` and `.env`:

```js
const path = require('node:path');
const { Client, Events, FileSessionStore } = require('yapperjs');

const store = new FileSessionStore(path.join(__dirname, '.data/session.json'));
const client = new Client({
  sessionStore: store,
  presence: { status: 'online' },
  commands: { prefix: '!', replyOnReject: true },
});

client.on(Events.Error, error => console.error(error.message));
client.on(Events.Warn, warning => console.warn(warning));
client.once(Events.ClientReady, ready => {
  console.log(`Ready as ${ready.user.username || ready.userId}`);
});

client.commands.register({
  name: 'ping',
  description: 'Check whether the bot responds',
  cooldown: 2000,
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

## Run your bot

From your project folder:

```sh
node --env-file=.env bot.cjs
```

Wait for `Ready as ...`. From another account, send `!ping` in a channel the bot
can access or in a DM. The bot replies `Pong!`. Send `!help` to list the commands
you registered. Stop with Ctrl+C; restart after changing your code or `.env`.

On the first successful login, the file store saves the current session. Remove
the first-use `YAPPER_VALUE` from `.env` afterward and keep `.env` for other
settings. Future runs restore `.data/session.json`, including replacement
credentials saved during refresh. See [session persistence](authentication.md#startup-and-saved-session-precedence)
if you need to switch accounts or recover a rejected session.

## What the starter does

| Part | Purpose |
| --- | --- |
| `FileSessionStore` | Keeps credentials between runs in your project |
| `presence: { status: 'online' }` | Sets online status and renews it every 45 seconds by default |
| `commands.register()` | Adds the bot's `ping` command |
| `addHelpCommand()` | Adds help for your registered commands |
| `login(saved ?? initial)` | Uses the latest saved pair before a first-use environment value |
| `destroy()` | Stops local connections, timers, and collectors on shutdown |

The `--env-file` flag is Node's environment loader. YapperJS does not load `.env`
or automatically read `YAPPER_VALUE`; the starter explicitly passes its value to
`login()`. A plain `new Client()` has memory-only storage and no configured
presence. Your project chooses those options.

## Native ESM and TypeScript

Use named imports in a `.mjs` file or a project configured for ESM:

```js
import { fileURLToPath } from 'node:url';
import { Client, Events, FileSessionStore } from 'yapperjs';

const client = new Client({
  sessionStore: new FileSessionStore(fileURLToPath(new URL('./.data/session.json', import.meta.url))),
  presence: { status: 'online' },
});
client.on(Events.Error, error => console.error(error.message));
```

Register commands and listeners and call `login()` as in the complete starter.
This snippet shows imports and a portable session path; it is not a complete bot.

TypeScript declarations ship with YapperJS; no separate `@types` package is
required. For example:

```ts
import { Client, type CommandDefinition } from 'yapperjs';

const client = new Client();
const ping: CommandDefinition = {
  name: 'ping',
  async execute(ctx) { await ctx.reply('Pong!'); },
};
client.commands.register(ping);
```

This fragment demonstrates typing and registration. Configure authentication
and login as above, and compile with your project's TypeScript tooling.

## Next steps

- [Commands and events](commands-and-events.md): add commands, access checks,
  and message listeners.
- [API reference](api.md): send messages and DMs, fetch users and history,
  and understand managers and caches.
- [Interactions](interactions.md): collect replies and build reaction controls.
- [Configuration](configuration.md): set status, activity, heartbeat timing,
  and other client options.
- [Authentication](authentication.md): encrypted storage, token refresh,
  and session recovery.
