# YapperJS documentation

YapperJS is an unofficial Node.js 22+ client for building Yapper bots. These
guides describe the implementation in this repository and its included test bot.
The library uses CommonJS, also provides native ESM exports and TypeScript
declarations, and has no runtime dependencies.

## Choose a guide

| Goal | Guide |
| --- | --- |
| Run a bot or create a separate bot project | [Getting started](getting-started.md) |
| Configure the client, environment, and heartbeat | [Configuration and presence](configuration.md) |
| Initialize, store, refresh, or recover a session | [Authentication and persistence](authentication.md) |
| Look up objects, managers, methods, and return values | [API reference](api.md) |
| Create commands and respond to gateway events | [Commands and events](commands-and-events.md) |
| Use reactions, collectors, menus, pages, and polls | [Interactions](interactions.md) |
| Change profiles, channels, servers, roles, and membership | [Customization and moderation](customization-and-moderation.md) |
| Diagnose startup, permissions, connection, and command failures | [Troubleshooting](troubleshooting.md) |

Start with [Getting started](getting-started.md), then use the API reference as a
lookup. The repository also has a [test-bot walkthrough](test-bot.md)
and a [library overview](../README.md). The walkthrough's source files are
checkout-only; the guides in this directory ship in the canonical root package.

## How the pieces fit

1. Your application constructs a `Client` and installs commands and listeners.
2. `login()` loads or accepts a session, authenticates, and fetches visible data.
3. The client populates user, server, channel, member, and role caches.
4. Realtime connects unless disabled. A configured presence starts its heartbeat.
5. New message events feed the command router and collectors.
6. Authenticated requests renew expiring credentials and persist replacements.
7. `destroy()` closes connections, stops timers and collectors, and clears memory.

Importing `yapperjs` performs none of those network operations. Constructing a
client creates an empty command router. Only your application or an explicit
example launcher registers commands and calls `login()`.

## Conventions used in the guides

- `guild` and `server` refer to the same Yapper server. `Server` aliases `Guild`,
  and `client.servers` aliases `client.guilds`.
- IDs are strings. Methods that accept an entity usually also accept its ID or
  an object with an `id` property; see the method's declaration for exceptions.
- Timing options are milliseconds unless a field explicitly says otherwise.
  Session expiry is Unix seconds; channel slowmode is seconds.
- Short examples assume an authenticated `client` and named objects such as
  `channel` or `message`. Run snippets with `await` inside an async function, or
  in a `.mjs` module. The starter programs are complete CommonJS files.
- Example IDs, keys, and credentials are placeholders. They are never working
  account credentials.
- Caches and live events represent visible, fetched, or received records. They
  are not complete inventories or durable event logs.

## Implemented capabilities and limits

| Area | Implemented | Boundary |
| --- | --- | --- |
| Messaging | Plain text, replies, edits, deletes, history, DMs | No attachment upload or rich embed builder |
| Commands | Text prefixes, aliases, arguments, cooldowns, owner checks, help | No native slash-command registration |
| Events | Messages, reactions, visible entities, membership, roles, auth, gateway | Delivery is best-effort; no automatic history replay |
| Interactions | Emoji menus, confirmation, pagination, polls, collectors | Ordinary reactions, not native buttons or modals |
| Presence | Status, activity, periodic heartbeat | Requires a running authenticated client and accepted requests |
| Administration | Profile/server/channel edits, roles, kicks, bans, timeouts | Yapper enforces permissions and role hierarchy |
| Sessions | Memory, plaintext files, encrypted files, custom stores | Revoked or rejected sessions can require a new login |

The latest integration checks in this work confirmed profile fetching, avatar
URLs, and the online heartbeat. Content-changing message edits were rejected by
the live API with `403/42501` and `permission denied for table profiles`.
[Troubleshooting](troubleshooting.md#message-edit-permission-error) explains that
observed server-side issue. Mocked tests can prove client behavior but cannot
guarantee that every operation is currently accepted by Yapper.

## Maintaining these guides

Use [the declarations](../YapperJS/index.d.ts) for exact argument and return
types, and the implementation for defaults and runtime behavior. When changing
the API, update the relevant guide and examples alongside it. See
[the verification workflow](troubleshooting.md#verification-and-packaging) before
producing a package.
