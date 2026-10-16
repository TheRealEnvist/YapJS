# Authentication and persistence

[Documentation index](README.md)

Your bot logs in with an account session. For most applications, the setup is:

1. Copy the account's encoded session from the browser once.
2. Pass it to `client.login()` with a persistent session store configured.
3. Restore the saved session on later runs; YapJS saves replacement tokens
   as it refreshes them.

The [complete starter](getting-started.md#complete-commonjs-starter) implements
this flow. The sections below explain inputs, storage choices, and recovery.

## Accepted login inputs

`client.login(input)` accepts an authorized session, not a Discord bot token or
an email/password pair. The library does not implement an interactive sign-in
flow or obtain a new independent session on your behalf.

| Input | Example | Behavior |
| --- | --- | --- |
| No argument | `client.login()` | Loads the configured session store |
| Session object | `{ access_token, refresh_token, expires_at }` | Normalizes and authenticates that session |
| JSON string | `process.env.YAPPER_SESSION` | Parses the JSON and follows the object path |
| Encoded Yapper value | `process.env.YAPPER_VALUE` | Decodes the session before normalization |
| Refresh-token-only object | `{ refresh_token }` | Exchanges it before authenticated use |

`expires_at` is Unix **seconds**. If it is absent or invalid, `expires_in` can
supply a lifetime in seconds; otherwise the JWT expiry is used as a scheduling
hint. The server still validates the token and account. A refresh token is
required for normalized sessions.

Example environment syntax; replace every placeholder with your authorized
session's actual value:

```dotenv
YAPPER_SESSION='{"access_token":"YOUR_ACCESS_TOKEN","refresh_token":"YOUR_REFRESH_TOKEN","expires_at":YOUR_UNIX_EXPIRY_SECONDS}'
```

The expiry placeholder must become a number for valid JSON. Alternatively,
provide only your refresh token:

```dotenv
YAPPER_SESSION='{"refresh_token":"YOUR_REFRESH_TOKEN"}'
```

Use your own independent bot session. Avoid running a browser and bot or two
processes against one refresh-token chain. The lock is per `Client` instance;
it does not coordinate multiple clients or machines.

## Find your bot token in the browser

The value used here as a "bot token" is the account's encoded login session.
Pass it directly to `client.login(value)`; there is no need to decode it or
extract the individual access and refresh tokens. The starter reads it from
an environment variable named `YAPPER_VALUE`.

1. Open Yapper on the web and sign in to the account you want to run as the bot.
2. Open the browser's developer tools. In Chrome or Edge on Windows, press
   **F12** or **Ctrl+Shift+I**.
3. Open **Application** in Chrome/Edge, or **Storage** in Firefox.
4. Expand **Local Storage** and select the Yapper origin you are signed into,
   for example `https://www.yapper.website`.
5. Find the entry whose key is **`yp:1n00fw`**. You can use the storage table's
   filter to search for that key.
6. Copy the complete **Value** for that entry, rather than the key name. Keep
   the encoded value unchanged.
7. Put it in `.env` in **your bot project's folder**:

   ```dotenv
   YAPPER_VALUE='PASTE_THE_COMPLETE_yp:1n00fw_VALUE_HERE'
   ```

8. Close that account's Yapper browser tabs before starting your bot. With the
   [starter](getting-started.md#complete-commonjs-starter), run
   `node --env-file=.env bot.cjs`. Use one running client for that session.

The copied value contains login credentials even though it is encoded. Keep it
private and out of source control. With a persistent `sessionStore` configured,
YapJS saves the current pair. Remove the first-use `YAPPER_VALUE` from `.env`
after successful initialization and let subsequent runs restore the store.

If `yp:1n00fw` is missing, confirm that login completed and that you selected
the storage origin for the current Yapper tab. Storage is separate for each
origin and browser profile. The starter below prefers a saved session, then
`YAPPER_SESSION`, then `YAPPER_VALUE`. Those environment names and that precedence
are choices made by your application, rather than automatic library behavior.

## Startup and saved-session precedence

Prefer the store's latest replacement pair when starting your application:

```js
const saved = await store.load();
const initial = process.env.YAPPER_SESSION || process.env.YAPPER_VALUE;
await client.login(saved ?? initial);
```

That precedence belongs to the application. Explicitly passing an older session
to `client.login(oldValue)` does not make the library choose a newer stored pair
instead. After successful initialization, remove first-use session values from
the environment and let the application restore its store.

Login verifies the account, loads bootstrap data, optionally connects realtime,
and optionally starts presence before ready events fire. An expired saved access
token can be renewed when its saved refresh token remains valid. A failed login
can be retried on an undestroyed client. A destroyed client requires a new instance.

## Choose a store

### Memory

`MemorySessionStore` is the default and keeps copies in memory. It is useful for
tests and short-lived programs. Restarting the process loses the stored session.

```js
const { Client, MemorySessionStore } = require('@therealenvist/yapjs');
const client = new Client({ sessionStore: new MemorySessionStore() });
```

### Plaintext file

```js
const path = require('node:path');
const { Client, FileSessionStore } = require('@therealenvist/yapjs');
const store = new FileSessionStore(path.join(__dirname, '.data/session.json'));
const client = new Client({ sessionStore: store });
```

`FileSessionStore` creates parent directories, writes a unique temporary file,
flushes it, and atomically renames it over the target. It requests owner-only
POSIX modes where supported. Windows access is governed by filesystem ACLs;
POSIX mode bits do not establish an owner-only NTFS ACL. The file is plaintext,
so use encrypted storage if that is required for your deployment.

Add the chosen session path to your project's `.gitignore`. The starter keeps
the file under `.data/` and ignores that directory; a different custom path needs
its own ignore rule.

`load()` returns a session or `null` when the file is missing. Invalid JSON or
storage errors raise `SessionStorageError`. `clear()` removes that store's file.

### Encrypted file

Generate an independent 32-byte key, for example:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep it separately from the encrypted file. In your application:

```js
const { Client, EncryptedFileSessionStore } = require('@therealenvist/yapjs');
const store = new EncryptedFileSessionStore(
  './.data/session.enc.json',
  process.env.YAPPER_SESSION_KEY,
);
const client = new Client({ sessionStore: store });
```

The store uses AES-256-GCM, a random nonce, and an authentication tag. Wrong keys
and tampered files are rejected. It does not import an existing plaintext file
automatically. Initialize the new store from your authorized session and then
restore it normally. Losing the key means the saved credentials cannot be
recovered through this store.

### Custom persistence

Implement this contract for a vault, database, or secret store:

```js
const sessionStore = {
  async load() { return await vault.readSession(); }, // Session object or null.
  async save(session) { await vault.replaceSession(session); },
  async clear() { await vault.deleteSession(); }, // Optional.
};
```

`save()` must replace the complete pair and reject on failure. The library
cannot make your remote storage atomic; implement that guarantee in the store.
Do not silently swallow a failed write.

## Rotation and persistence ordering

1. Expiry checks or the automatic timer decide renewal is needed.
2. Concurrent callers share one token exchange within the client.
3. The replacement access and refresh tokens enter memory.
4. The complete replacement session is saved.
5. Only after successful persistence are token events published and subsequent
   authenticated requests allowed to use the replacement pair.
6. A running gateway reconnects with the new access token.

If step 4 fails, authenticated requests remain blocked. The pair is retained in
memory, and recovery tries to save it again instead of exchanging the old token
again. The refresh endpoint and your storage cannot be one transaction: a
process crash after exchange and before save can still require reauthentication.

## Retry and invalidation behavior

| Failure or setting | Client behavior |
| --- | --- |
| Transient network/server refresh failure | Automatic backoff, initially 5 seconds and capped at 5 minutes |
| Numeric `Retry-After` | May extend the refresh retry delay beyond the backoff cap |
| Refresh endpoint HTTP 400/401/403 | Stops retries, invalidates the session, closes realtime/presence |
| Refresh returns another account | Invalidates the session |
| `autoRefresh: false` | No scheduled refresh/retry; on-demand expiry checks remain |
| Normal authenticated GET returns 401 | Refreshes when needed and retries that GET once |
| POST/PATCH/DELETE fails | Does not automatically replay the mutation |

Use the metadata events to observe recovery without logging credentials:

```js
const { Events } = require('@therealenvist/yapjs');
client.on(Events.TokenRefresh, ({ expiresAt }) => {
  console.log('Replacement session saved; expires at', expiresAt);
});
client.on(Events.RefreshRetry, ({ attempt, retryIn, status }) => {
  console.warn(`Refresh attempt ${attempt}: retry in ${retryIn}ms (${status})`);
});
client.on(Events.SessionInvalidated, ({ code }) => {
  console.error('A fresh authorized session is required:', code);
});
```

`client.auth.requiresLogin` becomes true on invalidation. A fresh explicit
`login(newSession)` can recover an undestroyed instance. Revocation, sign-out,
security changes, and server policy can require that new login; refresh is not
a guarantee of permanent access.

## Credential access and cleanup

`client.auth.getSession()` returns a copy containing credentials.
`getAccessToken()` returns the current usable token and may trigger renewal.
Legacy `client.token`, `refresh_token`, and `refreshtoken` expose credentials too.
Do not include them in logs, screenshots, issue reports, or committed examples.

`client.destroy()` clears in-memory credentials and timers, but leaves persisted
files intact and does not sign out. `store.clear()` removes local persistence;
it is not a server-side revocation operation.

See [Troubleshooting](troubleshooting.md#session-and-storage-problems) for rejected
sessions, stale environment values, and failed persistence.
