# Getting started

[Documentation index](README.md)

## Requirements

Use Node.js 22 or newer. The library relies on Node's built-in `fetch`,
`WebSocket`, environment-file loader in the launchers, and test runner. npm is
needed for the repository scripts and package checks. There are no library
runtime dependencies to install in this checkout.

Check your tools in PowerShell:

```powershell
node --version
npm.cmd --version
```

Use `npm.cmd` when PowerShell blocks `npm.ps1` under its execution policy. In
other shells, the normal `npm` spelling is sufficient.

## Run the included test bot

Run these commands from the repository root, which contains `package.json`:

```powershell
npm.cmd run bot:demo
npm.cmd run test:bot
```

The demo uses fake accounts and an in-memory API with the actual client and
command router. It does not load `.env`, touch session files, or connect to
Yapper. Its output shows ping, echo, profile lookup, status, message editing,
reactions, DMs, and help. A successful simulated edit does not establish that
Yapper's live API permits editing.

For a live connection:

1. If `.env` does not exist, copy the template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Use your own independent bot session. Existing
   `YapperJS/session.json` is restored automatically. On first use, supply an
   authorized session through `YAPPER_SESSION` or `YAPPER_VALUE` in `.env`.
   [Find your bot token in the browser](authentication.md#find-your-bot-token-in-the-browser)
   explains how to copy the `yp:1n00fw` value into `YAPPER_VALUE`.
   [Authentication](authentication.md#accepted-login-inputs) describes each input.
3. Start the bot:

   ```powershell
   npm.cmd run bot
   ```

4. Wait for `Ready as ...`, then send `!help` from another account in a channel
   the bot can access, or DM it. The router ignores the bot's own messages.
5. Try `!ping`, `!avatar`, `!userinfo`, `!status`, and `!dm hello`.
6. Stop with Ctrl+C. Restart after changing code or `.env`; these launchers do
   not watch files for changes.

The test bot marks itself online at login and renews that presence every 45
seconds. See [Configuration](configuration.md#online-heartbeats).

## Choose the right launcher

| Command or entry point | Purpose | Commands and presence |
| --- | --- | --- |
| `npm run bot` | Test bot in `examples/test-bot/bot.js` | Demonstration commands; online heartbeat by default |
| `npm run bot:demo` | Offline demonstration | Same test-bot command code against a fake API |
| `npm run example` | Configurable sample in `examples/bot/bot.js` | Demonstration and owner-only moderation commands; presence only when configured |
| `node bot/bot.js` | Compatibility launcher | Forwards to `npm run example`'s bot |
| `examples/private-dms.js` | Minimal standalone DM example | Replies to `!ping` in DMs; uses `.data/yapper-session.json` relative to the working directory |

The DM example does not load `.env` itself. Start it with an environment loader
or supply variables in your shell. Its session file is separate from the default
test-bot file. See [environment-variable scope](configuration.md#environment-variable-scope).

## Install the library in another project

From a consuming project, install the repository root as a local dependency:

```sh
npm install /absolute/path/to/YapperJS
```

For a portable archive, run `npm pack` from the repository root and install the
resulting tarball in the consuming project:

```sh
npm install ./yapperjs-0.7.0.tgz
```

The version in that filename follows `package.json`. This repository does not
establish that `yapperjs` is currently published on npm. Registry installation
requires the maintainer to publish it; a Git URL requires the relevant changes
to be pushed. The root package is canonical and bundles `docs/`. The nested
`YapperJS/` package remains a library-only compatibility option.

## Complete CommonJS starter

Save the following as `bot.cjs` in your consuming project. Set `YAPPER_SESSION`
only for initialization; subsequent runs restore the saved replacement pair.

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
  if (!saved && !initial) throw new Error('Supply an initial Yapper session.');
  await client.login(saved ?? initial);
}

main().catch(error => {
  console.error(error.message);
  client.destroy();
  process.exitCode = 1;
});
```

Start with a local environment file, without adding a dotenv dependency:

```sh
node --env-file=.env bot.cjs
```

The library itself does not load that file. The explicit Node flag loads it for
this program. Do not run a second client against the same refresh-token chain.

## Native ESM and TypeScript

Use named imports in a `.mjs` file or a project configured for ESM:

```js
import { Client, Events, FileSessionStore } from 'yapperjs';

const client = new Client({
  sessionStore: new FileSessionStore('./.data/session.json'),
  presence: { status: 'online' },
});
client.on(Events.Error, error => console.error(error.message));
```

Install listeners and commands before calling `login()` as in the CommonJS
starter. The package's `types` and conditional exports point TypeScript to
`YapperJS/index.d.ts`; no separate `@types` package is supplied or required.

```ts
import { Client, Events, type CommandDefinition } from 'yapperjs';

const client = new Client();
const ping: CommandDefinition = {
  name: 'ping',
  async execute(ctx) { await ctx.reply('Pong!'); },
};
client.commands.register(ping);
client.on(Events.MessageCreate, message => {
  console.log(message.id, message.authorId);
});
```

This last fragment demonstrates typing and registration; it does not log in.
Choose the appropriate module resolution for your consuming project. The
library does not provide a TypeScript compiler or build pipeline.

## Next steps

- [Configuration](configuration.md): all client options and launcher settings.
- [Commands and events](commands-and-events.md): add commands and live behavior.
- [API reference](api.md): messaging, caches, and manager methods.
- [Test-bot walkthrough](test-bot.md): command-by-command checks.
