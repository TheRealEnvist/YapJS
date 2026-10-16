# Troubleshooting and operations

[Documentation index](README.md)

## Start with the actual failure

Record the failing command, whether it ran in a DM/server, and the sanitized
console error. Distinguish a login failure, a command rejection, an API denial,
and a disconnected gateway. `!status` reports cached connection context; it does
not prove that every API action has permission to succeed.

| Symptom | Check |
| --- | --- |
| `npm.ps1` is blocked | Run `npm.cmd` from PowerShell |
| `No Yapper session found` | Configure an initial session or the correct session-file path |
| Invalid session JSON | Use one-line valid JSON and quote the whole value in `.env` |
| Ready bot does not answer its own `!ping` | Send from another account; self messages are intentionally ignored |
| No response to a command | Check prefix, known bot-author filtering, gateway connection, and access |
| Usage/access/cooldown reply | Command was rejected before execution; check arguments/owner IDs/context |
| `Command handler failed` with HTTP details | Inspect status, endpoint, and API code |
| Old profile values | Force-fetch public profile data; verify you restarted after config changes |
| Reactions exist but controls do nothing | Check audience, expiry, ended menu, repeated-toggle behavior, and edit errors |

## Read errors without exposing credentials

```js
const { Events, YapperAPIError } = require('yapperjs');
client.on(Events.Error, error => {
  console.error(error.message);
  const request = error instanceof YapperAPIError ? error : error.request;
  if (request) console.error(request.status, request.method, request.route, request.code);
});
```

Network/read failures use API status `0`; normal HTTP failures retain their
status. Wrapped command/menu/poll errors retain safe `.request` metadata.
`retryAfter` on that metadata is seconds, while command cooldown retryAfter is
milliseconds. Avoid logging `client.token`, session objects, authorization
headers, Raw gateway payloads, or arbitrary private response bodies.

## Message-edit permission error

During the integration testing reflected in these guides, changing the bot's
own message content returned HTTP `403`, SQLSTATE `42501`, and
`permission denied for table profiles`. Reading and sending messages worked;
setting the same content also succeeded. The content-changing denial came from
Yapper's API and could not be repaired by changing a client-side page renderer.

Consequences:

- `!test` reports `Edit: failed (Yapper API 403 (42501))` and still checks reactions.
- `!pages` creates one message and only edits that message. An edit denial leaves
  the page unchanged and stops the menu; it does not send page replacements.
- The sample `!poll` sends final results as a separate reply.
- Other helpers that edit content, including `interaction.update()`, can fail
  for the same reason.

This is an observed backend limitation, not a promise that every future 403 has
that cause. Check the operation and code. Yapper's server permissions must be
corrected for real in-place page changes to work; local owner IDs cannot grant
database privileges. A passing mock edit test proves the request handling and
cache behavior, not acceptance by the live service.

## Profile and avatar problems

The library reads explicit public profile fields because `profiles?select=*`
can return `403/42501`. Use `client.users.fetch(id, { force: true })` rather than
a raw wildcard query. Public profile response fields need not include private
or auth-only account flags.

`displayAvatarURL()` uses Yapper's media CDN and encodes path components. It
returns null when no avatar is set. `!avatar` sends that URL as plain text, so
image-preview behavior belongs to the Yapper UI. File uploads and rich embeds
are not implemented by this library. A stale cached avatar can be refreshed by
force-fetching the user; a custom installation can set `mediaBaseUrl`.

## Session and storage problems

| Failure | Response |
| --- | --- |
| Saved session keeps winning over a changed `.env` initializer | This is intentional rotation-safe precedence; decide explicitly whether you need a fresh independent session |
| Wrong encrypted-session key | Restore the correct key; the file is not silently treated as plaintext |
| SessionStorageError after rotation | Restore writable persistence; authenticated requests are blocked until the replacement pair is saved |
| RefreshRetry events | Allow transient recovery; inspect retryIn/status rather than launching another client with the same tokens |
| SessionInvalidated / `auth.requiresLogin` | Obtain a fresh authorized session; restart the launcher or explicitly log in again on an undestroyed client |
| Unexpected logged-out behavior with two clients | Stop sharing one refresh-token chain; use independently authenticated sessions |

Do not clear persisted files as a generic first troubleshooting step; they may
contain the latest usable replacement pair. If you intentionally switch sessions,
keep one process per store and avoid reusing an obsolete initializer. See
[Authentication](authentication.md) for the persistence ordering and recovery limits.

## Presence and connection problems

The test bot defaults online, while a bare Client and the configurable example
need presence configured. Check `YAPPER_STATUS`, especially `offline`, which
stops renewal. Heartbeat cadence defaults to 45 seconds after the preceding
operation completes. A failed initial heartbeat can reject login; later failures
are logged and renewed while the client remains ready and presence enabled.

Presence heartbeat and realtime connection are separate. `isReady()` can remain
true during a socket reconnect; check `gateway.connected`. A rejected session
stops both. Destroying a client stops heartbeats but does not send an explicit
offline update; the server expires stale visible status on its own schedule.

Use a running process for a live bot. The library does not install a system
service, restart crashed processes, or keep a stopped machine online. Configure
your own process supervisor if your deployment needs restart behavior, and give
that process a persistent store and environment.

## Reaction controls and collectors

Controls are ordinary emoji reactions. Remove and re-add a reaction to activate
the same arrow again. Only allowed users can use restricted menus, and menus
stop after their timeout, close action, relevant deletion, or an error. The
visible emojis remain after expiry. Creating a new `!pages` starts a new menu;
it does not revive the old one.

`!ask` waits for the next message from the invoking author in the same channel.
Arguments on the `!ask` invocation are not its answer. Await helpers resolve
empty Collections on timeout unless you list the end reason in `errors`.
Collectors do not replay interactions missed during a disconnect.

## Cache and event surprises

`message.author`, `member.user`, or an old update snapshot can be null. Check
before dereferencing. Use IDs for authorization, and fetch profiles when needed.
Unknown channel metadata does not imply a DM. Cached member counts are not an
authoritative census, and `guild.members.fetch()` only returns the current cache.

Local writes and gateway events can both update caches. Duplicate suppression is
bounded and in-memory. Removal does not identify whether someone left, was
kicked, or was banned. Refetch relevant data after interruptions when your
application needs reconciliation.

## Verification and packaging

Run from the repository root:

```powershell
npm.cmd run test:bot
npm.cmd test
npm.cmd run pack:check
npm.cmd pack
```

The test suite uses mocked APIs and offline package/install checks. The demo is
also offline. Neither demonstrates that every Yapper endpoint currently accepts
your account's operation. For an account-specific failure, keep the sanitized
HTTP evidence alongside the relevant command.

The canonical package includes library JS/ESM/declarations, Markdown guides,
README, license, and npm metadata. It excludes real `.env`, sessions, tests,
example code, and `node_modules`. The package check validates this allowlist;
`npm pack` creates an archive, not a registry publication or Git push.
