# Troubleshooting and operations

[Documentation index](README.md)

## Start with the actual failure

Record the failing method or command, whether it ran in a DM/server, and the
sanitized error. Check `client.isReady()` for initialization and
`client.gateway.connected` for realtime connectivity. API permissions are
checked separately for each operation.

| Symptom | Check |
| --- | --- |
| `npm.ps1` is blocked | Run `npm.cmd` from PowerShell |
| No session found at startup | Pass an initial session to `login()` or configure the correct session store |
| Invalid session JSON | Use one-line valid JSON and quote the whole value in `.env` |
| Ready bot does not answer its own command | Send from another account; self messages are intentionally ignored |
| No response to a command | Register the command; check prefix, bot-author filtering, gateway connection, and access |
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

`message.edit()` sends a content update to Yapper. A reported live failure
returned HTTP `403`, SQLSTATE `42501`, and `permission denied for table profiles`
even when the account edited its own message. Reading and sending still worked.
That response indicates a server-side permission denial.

Check the actual status and API code before assigning a cause to a failure.
Client owner IDs control command access; they cannot grant database privileges.
If Yapper rejects a content update, helpers using that update can fail too:

- `channel.paginate()` keeps the original page visible and stops its menu.
- `interaction.update()` rejects the update.
- Polls normally edit final results into their message. Set `updateOnEnd: false`
  and handle `poll.finished` yourself if you want another way to display results.

See [Interactions](interactions.md) for those APIs. The diagnostic commands'
behavior is documented separately in [Test-bot walkthrough](test-bot.md).

## Profile and avatar problems

The library reads explicit public profile fields because `profiles?select=*`
can return `403/42501`. Use `client.users.fetch(id, { force: true })` rather than
a raw wildcard query. Public profile response fields need not include private
or auth-only account flags.

`displayAvatarURL()` uses Yapper's media CDN and encodes path components. It
returns null when no avatar is set. Sending that URL as text leaves image-preview
behavior to the Yapper UI. File uploads and rich embeds
are not implemented by this library. A stale cached avatar can be refreshed by
force-fetching the user; a custom installation can set `mediaBaseUrl`.

## Session and storage problems

| Failure | Response |
| --- | --- |
| Saved session keeps winning over a changed `.env` initializer | The starter uses `saved ?? initial`; explicitly choose a new independent session if switching accounts |
| Wrong encrypted-session key | Restore the correct key; the file is not silently treated as plaintext |
| SessionStorageError after rotation | Restore writable persistence; authenticated requests are blocked until the replacement pair is saved |
| RefreshRetry events | Allow transient recovery; inspect retryIn/status rather than launching another client with the same tokens |
| SessionInvalidated / `auth.requiresLogin` | Obtain a fresh authorized session and call `login(newSession)` on an undestroyed client, or restart with a new client |
| Unexpected logged-out behavior with two clients | Stop sharing one refresh-token chain; use independently authenticated sessions |

Do not clear persisted files as a generic first troubleshooting step; they may
contain the latest usable replacement pair. If you intentionally switch sessions,
keep one process per store and avoid reusing an obsolete initializer. See
[Authentication](authentication.md) for the persistence ordering and recovery limits.

## Presence and connection problems

Presence is opt-in. Pass `presence: { status: 'online' }` to the constructor,
or call `client.user.setPresence()` after login. Check `client.presence.status`
and `.enabled`; `offline` stops renewal. Heartbeat cadence defaults to 45 seconds
after the preceding operation completes. A failed initial heartbeat can reject
login; later failures are reported and retried while presence remains enabled.

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
visible emojis remain after expiry. Create a new menu to start a fresh collector.

Create a message collector before the reply you want to receive, and check its
channel and author filters. Await helpers resolve empty Collections on timeout
unless you list the end reason in `errors`.
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

## Repository checks

For source changes, offline tests, and package verification, see
[Contributing](contributing.md). For diagnostic commands such as `!test` and
`!status`, see [Test-bot walkthrough](test-bot.md).
