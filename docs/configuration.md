# Configuration and presence

[Documentation index](README.md)

## Client options

Pass options to `new Client(options)` in your application. This guide describes
the package defaults. For the repository launchers' environment mappings, see
[Repository examples](examples.md#environment-variable-scope).

| Option | Default | Meaning |
| --- | --- | --- |
| `apiKey` | Nonempty `YAPPER_API_KEY`, otherwise the bundled public project key | Public project API key; an explicit empty option is invalid |
| `baseUrl` | Bundled Yapper HTTPS API origin | REST/auth origin; must use HTTPS |
| `gatewayUrl` | `wss://rt.yapper.website/ws` | Realtime URL; must use WSS |
| `mediaBaseUrl` | Bundled Yapper public media CDN | Host used by `displayAvatarURL()`; HTTPS required |
| `sessionStore` | `MemorySessionStore` | Application-owned credential persistence |
| `realtime` | `true` | Start the gateway during login |
| `autoRefresh` | `true` | Schedule token refreshes and transient-failure retries |
| `refreshMargin` | `60000` | Refresh lead time in milliseconds; shortened for short-lived tokens |
| `refreshRetryDelay` | `5000` | Initial transient refresh retry delay |
| `refreshRetryMaxDelay` | `300000` | Maximum exponential backoff before Retry-After is considered |
| `requestTimeout` | `15000` | Timeout in milliseconds for an individual HTTP request |
| `gatewayTimeout` | `15000` | Initial gateway authentication timeout in milliseconds |
| `messageCacheMaxSize` | `200` | Positive maximum message records per channel |
| `presence` | Unconfigured | Initial status/activity; configured presence starts heartbeats |
| `presenceInterval` | `45000` | Heartbeat interval in milliseconds; integer from 1000 through 2147483647 |
| `commands` | Empty router with defaults below | Prefix, owners, cooldowns, and reply behavior |
| `fetch` | `globalThis.fetch` | Optional HTTP implementation override |
| `WebSocket` | `globalThis.WebSocket` | Optional gateway implementation override |

`autoRefresh: false` disables scheduled refresh/retry timers. An authenticated
request can still trigger an on-demand refresh when the session needs renewal.
Likewise, `realtime: false` disables the socket, not REST requests or an explicitly
configured presence heartbeat.

`refreshMargin` must be finite and nonnegative. Retry delays are safe integer
milliseconds: the initial delay is at least 1000 and the maximum must be at least
the initial delay. Invalid validated options throw during construction, before
login.

```js
const { Client, FileSessionStore } = require('@therealenvist/yapjs');

const client = new Client({
  sessionStore: new FileSessionStore('./.data/session.json'),
  messageCacheMaxSize: 100,
  presence: { status: 'online', activity: 'Answering questions' },
  presenceInterval: 45000,
  commands: {
    prefix: ['!', '?'],
    owners: ['YOUR_USER_ID'],
    cooldown: 1000,
    replyOnReject: true,
  },
});
```

## Command-router defaults

| Option | Default | Purpose |
| --- | --- | --- |
| `prefix` | `!` | String, array, or function returning the accepted prefixes |
| `owners` | Empty list | User IDs allowed to invoke owner-only commands |
| `cooldown` | `0` milliseconds | Per-command, per-author delay; individual commands can override it |
| `ignoreBots` | `true` | Ignore messages from known bot accounts |
| `replyOnReject` | `false` | Send short usage, access, and cooldown replies when true |

Register commands yourself through `client.commands.register()` or
`client.commands.load()`. Call `addHelpCommand()` if you want built-in help.
See [Commands and events](commands-and-events.md).

## Environment-variable scope

YapJS does not load `.env`. You can load it with Node and map settings to
options in your code:

```sh
node --env-file=.env bot.cjs
```

```js
const client = new Client({
  sessionStore: new FileSessionStore('./.data/session.json'),
  commands: { prefix: process.env.YAPPER_PREFIX || '!' },
  presence: {
    status: process.env.YAPPER_STATUS || 'online',
    activity: process.env.YAPPER_ACTIVITY || null,
  },
});
```

Here `Client` and `FileSessionStore` are imports from `@therealenvist/yapjs`. The application
chooses the environment names and fallback values. `YAPPER_VALUE` and
`YAPPER_SESSION` become login inputs only when your code passes them to `login()`.
Likewise, encryption requires constructing `EncryptedFileSessionStore`; setting
`YAPPER_SESSION_KEY` alone does not select a store.

`YAPPER_API_KEY` is the exception: the client reads a nonempty value as its public
project-key fallback when `options.apiKey` is omitted. Most applications can use
the bundled public key.

The separate [repository environment table](examples.md#environment-variable-scope)
describes the mappings already implemented by the sample launchers.

## Session paths

A default `Client` uses memory and creates no session file. To persist a session,
provide a store with a path in your application, outside the installed package:

```js
const path = require('node:path');
const store = new FileSessionStore(path.join(__dirname, '.data/session.json'));
```

In this CommonJS example, the path is anchored to the script directory.
`FileSessionStore('./.data/session.json')` instead resolves against the process's
current working directory. Use `fileURLToPath(new URL(..., import.meta.url))` for
an ESM script-relative path, as shown in [Getting started](getting-started.md#native-esm-and-typescript).

Use separate paths for plaintext and encrypted stores, and one independently
authenticated session per running client. See [Authentication](authentication.md).

## Online heartbeats

Configure presence to keep your bot marked online while it runs:

```js
const client = new Client({
  sessionStore: new FileSessionStore('./.data/session.json'),
  presence: { status: 'online', activity: 'Answering questions' },
  presenceInterval: 45000,
});
```

Login sends the initial heartbeat before `ClientReady`. The presence manager
schedules another heartbeat 45 seconds after the preceding operation completes
by default, so a slow request can extend the interval. It uses authenticated
REST and the normal token refresh manager.

A plain `Client` starts no heartbeat until you supply `presence` or call a
presence setter after login:

```js
await client.user.setPresence({ status: 'online', activity: 'Answering questions' });
await client.user.setStatus('idle');
await client.user.setActivity('Back soon');
await client.user.setActivity(null); // Clear activity while keeping the status.
```

| Status | Heartbeat behavior |
| --- | --- |
| `online`, `idle`, `dnd`, `invisible` | Sends the chosen status and keeps renewing |
| `offline` | Sends the protocol's offline state and stops automatic renewal |

`client.presence.status`, `.activity`, and `.enabled` describe the accepted local
presence. `client.presence.heartbeat()` sends one heartbeat; it does not itself
enable the periodic schedule. Activity may be a string, `{ name, since }`, or
`null`; `since` is a nonnegative Unix timestamp in milliseconds and defaults to
the current time.

If a scheduled heartbeat fails, it reports an error and schedules another while
presence remains enabled and the client is ready. A rejected initial heartbeat
can reject `login()`. Session invalidation and `destroy()` stop the schedule.

## Shutdown and visible offline status

Call `client.destroy()` during shutdown to stop local renewal and close
connections. The server decides when a stale online indication expires.
Destroy does not send an explicit offline request or sign out.

If your application needs to request offline status before shutting down:

```js
async function shutdown() {
  try {
    if (client.isReady()) await client.user.setStatus('offline');
  } finally {
    client.destroy();
  }
}
```

Handle a rejection from that async function in your signal handler. Do not rely
on async cleanup after an uncatchable termination or sudden power loss.
