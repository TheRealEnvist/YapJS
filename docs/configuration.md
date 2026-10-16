# Configuration and presence

[Documentation index](README.md)

## Client options

Pass options to `new Client(options)`. These are library settings, independent of
whether you use a supplied launcher.

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
| `fetch` | `globalThis.fetch` | HTTP implementation, useful for tests |
| `WebSocket` | `globalThis.WebSocket` | Gateway implementation, useful for tests |

`autoRefresh: false` disables scheduled refresh/retry timers. An authenticated
request can still trigger an on-demand refresh when the session needs renewal.
Likewise, `realtime: false` disables the socket, not REST requests or an explicitly
configured presence heartbeat.

`refreshMargin` must be finite and nonnegative. Retry delays are safe integer
milliseconds: the initial delay is at least 1000 and the maximum must be at least
the initial delay. Invalid validated options throw during construction, before
login.

```js
const { Client, FileSessionStore } = require('yapperjs');

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

| Option | Bare library default | Test bot default |
| --- | --- | --- |
| `prefix` | `!` | `!`, or `YAPPER_PREFIX` when started by the launcher |
| `owners` | Empty list | Empty list unless passed through factory options |
| `cooldown` | `0` milliseconds | `1000` milliseconds |
| `ignoreBots` | `true` | `true` |
| `replyOnReject` | `false` | `true` |

The configurable `npm run example` launcher reads `YAPPER_OWNER_IDS`. The
`npm run bot` launcher does not: it registers no moderation commands. To use
owner-only commands in a custom test-bot extension, pass
`commands: { owners: ['YOUR_USER_ID'] }` to `createTestBot()`.

## Environment-variable scope

Only the named launchers load the repository root `.env` automatically. Existing
process environment values take precedence under Node's loader. Changes take
effect on restart. Ordinary library imports do not read `.env`.

| Variable | Test bot: `npm run bot` | Configurable example: `npm run example` |
| --- | --- | --- |
| `YAPPER_SESSION` | First-use JSON/session input | Same |
| `YAPPER_VALUE` | First-use encoded session input | Same |
| `YAPPER_SESSION_KEY` | Enables encrypted session storage | Same |
| `YAPPER_SESSION_FILE` | Custom session path | Not read |
| `YAPPER_API_KEY` | Optional public key override | Optional public key override |
| `YAPPER_PREFIX` | Command prefix | Command prefix |
| `YAPPER_STATUS` | Default `online` | Presence is unconfigured unless status/activity is supplied |
| `YAPPER_ACTIVITY` | Optional presence activity | Optional presence activity |
| `YAPPER_ENABLE_COMMANDS` | Not read; bundled commands are registered | `0` disables bundled command registration |
| `YAPPER_OWNER_IDS` | Not read | Comma-separated IDs for owner-only commands |
| `YAPPER_LOG_MESSAGES` | Not read | `1` enables server-message logging |
| `YAPPER_BIO` | Not read | Optional account bio update at startup |
| `YAPPER_DISPLAY_NAME` | Not read | Optional display-name update |
| `YAPPER_CUSTOM_STATUS` | Not read | Optional custom-status text update |
| `YAPPER_PRONOUNS` | Not read | Optional pronouns update |
| `YAPPER_ACCENT_COLOR` | Not read | Optional `#RRGGBB` accent-color update |

The private-DM example reads `YAPPER_SESSION` and uses the library's API-key
fallback, but does not load `.env` itself. It has no automatic heartbeat configured.
`YAPPER_SESSION_KEY` is interpreted by the example launchers, not by bare `Client`.

## Session paths

| Setup | Default file |
| --- | --- |
| Test bot, plaintext | Repository-root `YapperJS/session.json` |
| Test bot, encrypted | Repository-root `YapperJS/session.enc.json` |
| Configurable example | The same defaults as above |
| Minimal DM example | Working-directory `.data/yapper-session.json` |
| Bare `Client` | No file; memory only |

For the test bot, a relative `YAPPER_SESSION_FILE` is resolved against the
repository root, even if you launch its script from another directory. An
absolute path is used as supplied. `FileSessionStore('./relative/path')` in your
own application resolves against that application's current working directory.

Do not point a plaintext store at an encrypted file, or share one rotating session
between multiple running processes. See [Authentication](authentication.md).

## Online heartbeats

The test bot configures `{ status: 'online' }` by default. Login sends the initial
heartbeat before `ClientReady`. The presence manager schedules another heartbeat
45 seconds after the preceding operation completes, so a slow request can extend
the interval. It uses authenticated REST and the same refresh manager as other
requests; there is no separate heartbeat credential.

A bare `Client` starts no heartbeat until you supply `presence` or call a presence
setter after login:

```js
await client.user.setPresence({ status: 'online', activity: 'Testing commands' });
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

The provided test-bot signal handlers call `destroy()`. That stops local renewal
immediately; the server decides when a stale online indication expires. Destroy
does not send an explicit offline request or sign out.

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
