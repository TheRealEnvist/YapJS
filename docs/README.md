# YapperJS documentation

Use YapperJS to build your own Yapper bot in a Node.js application. These guides
cover the public package API, from first login to messages, commands, interactive
controls, and server management.

Requires Node.js 22 or newer. CommonJS, native ESM, and TypeScript declarations
are included, with no runtime dependencies.

## Start here

1. [Getting started](getting-started.md): install YapperJS in a new project,
   create `bot.cjs`, and run your first command.
2. [Authentication](authentication.md): find your account's session and choose
   how your application saves it between runs.
3. [Commands and events](commands-and-events.md): add your bot's behavior.

You can build a bot using the installed package and these guides. The repository's
example launchers are optional.

## Find a topic

| I want to… | Read |
| --- | --- |
| Set options, prefixes, status, activity, or heartbeat timing | [Configuration and presence](configuration.md) |
| Send, edit, delete, or fetch messages; work with users and DMs | [API reference](api.md) |
| Register commands, load command files, or handle realtime events | [Commands and events](commands-and-events.md) |
| Collect replies, react, create menus, confirm, paginate, or poll | [Interactions](interactions.md) |
| Edit profiles, manage channels/servers, assign roles, or moderate | [Customization and moderation](customization-and-moderation.md) |
| Diagnose login, permission, cache, or connection problems | [Troubleshooting](troubleshooting.md) |

## How a client works

1. Create a `Client` with your options and session store.
2. Register commands and event listeners.
3. Call `login()` with an initial session, or restore your saved session.
4. The client authenticates, loads visible users/servers/channels, and connects
   realtime unless disabled. Configured presence starts its heartbeat.
5. Incoming events feed your listeners, command router, and collectors.
6. The authentication manager refreshes expiring tokens and saves replacements.
7. Call `destroy()` during shutdown to close connections and stop timers.

Importing the package does not connect or load `.env`. Your application supplies
configuration and decides when to log in. A newly constructed client has no
registered commands and no configured presence.

## Reading the examples

- Complete starter programs include imports, initialization, login, and cleanup.
- Short API snippets assume an authenticated `client` and objects such as
  `channel` or `message`. Use `await` inside an async function or ES module.
- IDs such as `CHANNEL_ID` and `USER_ID` are placeholders for actual string IDs.
- `guild` means a Yapper server. `Server` aliases `Guild`, and `client.servers`
  is the same manager as `client.guilds`.
- Durations are milliseconds unless stated otherwise. Session expiry is Unix
  seconds; channel slowmode is seconds.
- Related models such as `message.author` can be null until fetched. Caches
  contain visible records that have been loaded or received, rather than a full
  inventory of the service.

Use the [API reference](api.md) for method behavior and
[TypeScript declarations](../YapperJS/index.d.ts) for exact signatures.

## Capabilities and limits

| Area | Supported | Limits |
| --- | --- | --- |
| Messaging | Plain text, replies, edits, deletes, history, DMs | No attachment upload or rich embed builder |
| Commands | Prefixes, aliases, arguments, cooldowns, owner checks, help | No native slash-command registration |
| Events | Messages, reactions, entities, membership, roles, auth, gateway | Best-effort delivery; no automatic history replay |
| Interactions | Emoji menus, confirmation, pagination, polls, collectors | Reactions rather than native buttons or modals |
| Presence | Status, activity, periodic heartbeat | Requires a running authenticated client |
| Administration | Profile/server/channel edits, roles, kicks, bans, timeouts | Subject to Yapper permissions and role hierarchy |
| Sessions | Memory, plaintext files, encrypted files, custom stores | Rejected or revoked sessions can require login again |

YapperJS is unofficial. API availability and permissions are controlled by
Yapper. For an operation that fails, use [Troubleshooting](troubleshooting.md)
to inspect the error and identify the affected API call.

## Optional repository guides

These guides are for running or changing the source repository:

- [Repository examples](examples.md): choose a sample bot and configure it.
- [Test-bot walkthrough](test-bot.md): exercise the bundled diagnostic commands.
- [Contributing](contributing.md): source layout, tests, and package checks.

All Markdown guides ship under `docs/`. Runnable example files and repository
test scripts are available in the source checkout.
