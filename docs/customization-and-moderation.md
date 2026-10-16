# Customization and moderation

[Documentation index](README.md)

The following examples assume an authenticated client and an intentional action
in a server the account can manage. The server enforces permissions, hierarchy,
membership, and other limits. The library does not calculate effective Discord
permissions or grant access based on a local cache.

## Account profile

Only `client.user` is a `ClientUser` with account-editing methods.

```js
await client.user.edit({
  displayName: 'Community Helper',
  bio: 'Ask me for help with commands.',
  customStatus: 'Ready to help',
  pronouns: 'they/them',
  accentColor: '#55aaff',
});
```

| Option | Validation / clearing behavior |
| --- | --- |
| `username` | 2–32 letters, digits, dots, or underscores |
| `bio` | Up to 190 characters; empty string clears |
| `displayName`, `pronouns` | Text; null or empty clears |
| `customStatus` | Up to 80 characters; null or empty clears |
| `accentColor`, `accentColor2` | `#RRGGBB` or null |
| `avatar`, `banner` | Existing media path or null; no file upload helper |

Unspecified fields remain unchanged. Unknown fields throw. Convenience methods
include `setBio`, `setUsername`, `setDisplayName`, `setPronouns`,
`setCustomStatus`, and `setAccentColor`. Profile updates return the current
ClientUser and emit `UserUpdate(previous, current)` after a matching successful
response. Update responses select explicit public fields.

Presence status and profile custom-status text are separate features.
`setStatus('online')` updates presence/heartbeat; `setCustomStatus('Hello')`
updates profile text. See [Configuration](configuration.md#online-heartbeats).

## Get server context

```js
const guild = await client.guilds.fetch('SERVER_ID');
if (!guild) throw new Error('Server unavailable.');
const channel = await guild.channels.fetch('CHANNEL_ID');
if (!channel) throw new Error('Channel unavailable in this server.');
```

Server-specific managers check entity scope. Passing a role/member object from
another server does not turn it into a valid target in this one.

## Channels

```js
const created = await guild.channels.create({ name: 'bot-testing', type: 'text' });
await created.setName('bot-commands');
await created.setNoImages(true);
```

Creation accepts a name and type `text` or `voice`. Text names are normalized by
the library's channel-name validator: lowercase, whitespace replaced with
hyphens, and unsupported punctuation removed. Voice names keep their case and
collapse repeated whitespace. Both types are limited to 100 characters after
normalization. The public creator RPC is followed by a
fetch of the authoritative row. If that follow-up fetch fails, the channel may
already exist; do not blindly repeat creation.

Channel editing accepts only `name` and `noImages`. Posting and visibility use
their own helpers:

```js
await channel.setAccess({ private: true, roleIds: ['ROLE_ID'] });
await channel.setPosting({
  readOnly: true,
  roleIds: ['POSTING_ROLE_ID'],
  slowmode: 10,
});
```

`slowmode` is a nonnegative integer in **seconds**. Access/posting helpers
reload the channel after the server applies the setting. Role IDs are passed
to Yapper for its permission checks. `channel.delete()` and
`guild.channels.delete(id)` are server-channel operations, not DM close actions.

`guild.channels.setPositions(ids)` takes ordered, unique IDs from this server.
Positions update locally only after the reorder RPC succeeds. Channel ordering
uses the array's order starting at zero; role ordering below is highest first.

## Servers

```js
await guild.setName('My Community');
await guild.setDiscovery({
  discoverable: true,
  description: 'A place to chat and build.',
  tags: ['community', 'development'],
});
```

`client.guilds.create(name)` or `.create({ name, icon })` creates a server.
`guild.edit({ name?, icon? })` preserves unspecified values, and
`setDescription()` delegates to discovery settings. Icon values are existing
paths; upload is outside these helpers. `guild.leave()` and `guild.delete()`
prune that server's local channels/members only after a successful server action.

## Roles

```js
const role = await guild.roles.create({ name: 'Helpers', color: '#55aaff' });
await role.edit({ name: 'Community Helpers', color: '#aabbcc' });
await role.setPermissions({ manage_messages: true });
```

| Operation | Accepted fields or behavior |
| --- | --- |
| `create(options)` | `name`, `color`, `position`, `manageServer`, `manageMessages`; omitted name defaults to `new role` |
| `edit(id, options)` / `role.edit(options)` | Creation fields plus `color2`, `permissions`, `auto`, `autoBefore` |
| `setPermissions(map)` | Replaces explicit permission map and clears legacy broad manageServer/manageMessages flags |
| `fetch()` | Fetches all authorized roles in that server with pagination |
| `fetch(id, { force? })` | Cached/scoped individual role lookup |
| `setPositions(ids)` | Unique IDs, highest role first |
| `delete(id)` / `role.delete()` | Deletes role and removes local assignments after success |

Colors are six-digit hex strings or null. Clearing `color` also clears `color2`.
Role names are at most 100 characters, positions are nonnegative integers, and
permission names map to boolean values.

`role.permissions` is Yapper's raw permission map, not a computed effective
permission result. `role.edit({ permissions: map })` preserves legacy broad
flags unless explicitly changed; use `setPermissions()` when you want those
flags cleared too.

Automatic modes are `none`, `all`, and `before`. The `before` mode needs a valid
`autoBefore` date. Automatic roles derive from membership/join time and cannot
be manually assigned or removed through member-role helpers.

## Membership and nicknames

```js
const member = await guild.members.fetch('USER_ID');
if (!member) throw new Error('Member unavailable.');
await member.setNickname('Helper');
await member.roles.add('ROLE_ID');
```

`member.roles.remove(role)` removes a manual assignment.
`member.setNickname(null)` clears a nickname. ID-based methods are available on
`guild.members` when the target is not cached. Fetching a member does not imply
its public User is loaded; fetch `client.users.fetch(member.id)` if needed.

## Timeouts, kicks, and bans

```js
await guild.members.timeout('USER_ID', 10 * 60000, 'Repeated spam');
```

Timeout duration is positive **milliseconds in whole minutes**. Reasons are
optional text up to 200 characters. The server may impose further duration
limits. Clearing a timeout is not exposed by a verified helper.

The available explicit actions are `member.kick()`, `member.ban()`,
`guild.members.kick(id)`, `guild.members.ban(id)`, `guild.bans.create(id)`, and
`guild.bans.remove(id)`. Ban/kick helpers do not accept invented audit reasons
or Discord-style message-history deletion options.

```js
const bans = await guild.bans.fetch();
const ban = await guild.bans.fetch('USER_ID');
console.log(bans.size, ban?.createdAt);
```

Ban reads are paginated and scoped to the selected server. A newly created ban
has no authoritative timestamp until fetched. Successful kicks/bans update local
membership and emit removal when applicable; matching gateway echoes are
suppressed. A removal event still does not identify a moderator or cause.

## Message deletion and partial batches

```js
await channel.messages.delete('MESSAGE_ID');
```

`channel.bulkDelete(input)` and `channel.messages.bulkDelete(input)` accept a
count from 1–100, or an array/Collection of 1–100 message IDs/objects. A count
fetches recent messages and can include the invoking command. Explicit targets
are validated before deletion begins.

Deletion is sequential, not atomic. A failed batch stops at the first failure:

```js
const { MessageBulkDeleteError } = require('@therealenvist/yapjs');
try {
  await channel.bulkDelete(['MESSAGE_1', 'MESSAGE_2']);
} catch (error) {
  if (!(error instanceof MessageBulkDeleteError)) throw error;
  console.error('Confirmed deletions:', [...error.deleted.keys()]);
  console.error('Failed message:', error.failedId);
}
```

Do not repeat the whole batch after partial success. Successful local deletions
emit MessageDelete immediately and stop affected collectors. Deleting a message
does not currently clean up its uploaded attachment objects.

## Add moderation commands to your bot

Call these methods from commands you register with `client.commands`.
Use `ownerOnly`, `guildOnly`, and `authorize(ctx)` to control who can invoke
them. Those checks govern your application; Yapper still checks the bot account's
server permissions. See [command authorization](commands-and-events.md#authorization).

For the repository sample's prebuilt commands and their environment settings,
see [Repository examples](examples.md#sample-moderation-commands).
