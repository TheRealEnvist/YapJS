# API reference

[Documentation index](README.md) · [Exact TypeScript declarations](../YapperJS/index.d.ts)

Methods that make requests return promises. Unless a method says otherwise,
valid missing IDs resolve to `null`; invalid arguments or API failures throw.
Mutations require the authenticated account's permissions. This reference uses
JavaScript property names, which can differ from Yapper's database field names.

## Find the right object

| Task | Start with |
| --- | --- |
| Log in, check readiness, or shut down | [Client](#client) |
| Find an entity by ID or refresh cached data | [Fetch patterns](#fetch-patterns) |
| Read a profile or get an avatar URL | [Users and ClientUser](#users-and-clientuser) |
| Send to a channel or open a DM | [Channels and direct messages](#channels-and-direct-messages) |
| Reply, edit, delete, react, or read history | [Messages and message history](#messages-and-message-history) |
| Work with servers, members, roles, or bans | [Servers, members, roles, and bans](#servers-members-roles-and-bans) |
| Handle a failed request or use a lower-level endpoint | [REST and errors](#rest-and-errors) |

Managers such as `client.channels` find and cache objects. A returned `Channel`
represents one channel and provides actions such as `send()`. That action returns
a `Message`, which provides `reply()`, `edit()`, `delete()`, and `react()`.
`Collection` is the Map-like container returned by many list and history methods.

If you have not created an authenticated client yet, follow
[Getting started](getting-started.md) first. Short snippets here assume that client
already exists and run inside an async function or ES module.

## Client

Construct with `new Client(options)`. `Yapper` is an alias for `Client`. See
[Configuration](configuration.md#client-options) for every constructor option.

| Property | Value |
| --- | --- |
| `user` / `userId` | Authenticated `ClientUser` / ID, or `null` before ready and after destruction |
| `readyAt` / `uptime` | Ready date / elapsed milliseconds, or `null` while not ready |
| `users`, `channels`, `guilds` | Top-level managers |
| `servers` | The same manager as `guilds` |
| `dms`, `commands`, `presence` | DM, text-command, and presence managers |
| `auth`, `rest`, `gateway` | Authentication, HTTP, and realtime interfaces |
| `bootstrapData` | Last bootstrap response; can contain private visible-account data |
| `botProfile` | Auth user data; use `user` for the normal public model |

| Method | Result and behavior |
| --- | --- |
| `login(session?)` | Resolves to this client after authentication/bootstrap and optional gateway/presence startup |
| `isReady()` | Boolean; also narrows `user` and `readyAt` in TypeScript |
| `fetchBootstrap()` | Refetches visible bootstrap data and reconciles caches |
| `createDM(user, { force? })` | Gets/creates a one-to-one DM `Channel` |
| `sendDM(user, content)` | Sends to that recipient and returns a `Message` |
| `setPresence(options)` | Delegates to the presence manager |
| `on`, `once`, `off` | EventEmitter-style listener registration/removal |
| `destroy()` | Synchronous local cleanup; the instance cannot be logged in again |
| `toJSON()` | Public ready/user/cache-count summary; not a credential export |

`isReady()` describes client initialization/authentication, not socket health.
Check `client.gateway.connected` separately after a disconnect. See
[Events](commands-and-events.md#gateway-and-delivery-behavior).

Legacy `Client.create(value, apiKey, insecureLogin?)` creates a REST-only client.
With the third argument true, it uses working-directory
`.data/yapper-session.json` and prefers that saved pair. `refreshToken()` aliases
the auth refresh operation. New applications should use the constructor and
`login()` explicitly.

## Collections and caches

`Collection` extends `Map`. Entries are normally keyed by string IDs.

| Helper | Result |
| --- | --- |
| `get(id)`, `has(id)`, `size`, `values()`, iteration | Standard Map behavior |
| `first()` / `last()` | First/last value or `undefined` |
| `first(n)` / `last(n)` | Array of up to `n` values |
| `find(predicate)` | First matching value or `undefined` |
| `filter(predicate)` | New Collection containing matching entries |
| `map(predicate)` | Array of mapped values |
| `some`, `every`, `reduce` | Predicate/reduction helpers |
| `clone()` | Shallow Collection copy; entity objects are still shared |
| `toJSON()` | Array of values |

```js
const general = client.channels.cache.find(channel => channel.name === 'general');
const textChannels = client.channels.cache.filter(channel => channel.isTextBased());
const names = textChannels.map(channel => channel.name || channel.id);
```

Message caches are bounded per channel. Other caches reflect bootstrap,
explicit fetches, local writes, and received events. Their counts are cached
counts, not guaranteed full server/user totals.

## Fetch patterns

| Manager operation | Reads the network? |
| --- | --- |
| `client.users.fetch()`, `channels.fetch()`, `guilds.fetch()` | No; returns current cache |
| Those managers' `fetch(id)` | Uses cache if present; otherwise fetches that ID |
| Those managers' `fetch(id, { force: true })` | Yes |
| Those managers' `fetch(undefined, { force: true })` | Fetches visible rows; API response limits still apply |
| `guild.channels.fetch()` | Fetches channels in that server |
| `guild.members.fetch()` | No; returns current member cache |
| `guild.members.fetch(id, { force: true })` | Fetches one scoped member |
| `guild.roles.fetch()` | Fetches the server's role list with pagination |
| `guild.bans.fetch()` | Fetches the server's ban list with pagination |
| `client.dms.fetch()` | No; returns cached DM channels |
| `client.dms.fetch(channelId)` | Fetches the DM channel and its membership |

`resolve(value)` performs a cache lookup rather than a request. Prefer
`guild.channels.resolve(id)` when you need to verify server membership. A cache
miss is not proof that an entity does not exist or that the account can access it.

## Users and ClientUser

| User property | Meaning |
| --- | --- |
| `id`, `username`, `displayName` | Identity and public names; some fields may be unavailable |
| `avatar`, `banner` | Existing media paths, or null/unavailable |
| `bio`, `pronouns`, `customStatus` | Public profile text |
| `accentColor`, `accentColor2` | Profile theme colors |
| `bot` | Known bot flag, when supplied by cached/auth profile data |
| `dmChannel` | Cached one-to-one DM with this user, or null |

| User method | Result |
| --- | --- |
| `displayAvatarURL()` | Encoded public avatar URL, or null if no image is set |
| `createDM({ force? })` | DM Channel |
| `send(content)` | Message sent in the user's DM |
| `toString()` | `@username` or `@id` |

Profile fetches select explicit public columns; wildcard reads are denied by
Yapper's column permissions. A fetched profile need not include every flag that
bootstrap or auth metadata supplied. Avatar paths use the configured media CDN;
site-relative avatar paths become absolute Yapper website URLs.

The logged-in user's model is a `ClientUser`, which adds profile and presence
setters. See [Customization](customization-and-moderation.md#account-profile).
Other `User` objects do not gain account-editing methods.

## Channels and direct messages

Common Channel properties are `id`, `name`, `type`, `guildId`, `guild`, `topic`,
`position`, `noImages`, `readOnly`, `slowmode`, and `private`. DM channels can have
`memberIds`; `guild` is null for a DM.

`ChannelType` exports `GuildText: 'text'`, `GuildVoice: 'voice'`, `DM: 'dm'`, and
`GroupDM: 'group'` for comparisons against `.type`.

| Method | Behavior |
| --- | --- |
| `isDMBased()` | True for known DM/group metadata; unknown channels are not assumed to be DMs |
| `isTextBased()` | False for voice channels |
| `send(content)` | Creates a plain-text Message; voice text sends are rejected |
| `sendTyping()` | Sends a gateway typing event; returns whether it could be sent |
| `createMessageCollector`, `awaitMessages` | Message collection helpers |
| `sendReactionMenu`, `confirm`, `paginate`, `createPoll` | Interaction helpers |
| `edit`, `setName`, `setNoImages`, `setAccess`, `setPosting` | Server-channel configuration |
| `delete()` | Deletes a server channel; not a DM-close helper |
| `bulkDelete(input)` | Sequential deletion with partial-failure reporting |

DM creation is shared across concurrent requests for the same recipient and
reuses known one-to-one channels. `force: true` rechecks through the API.
Blocks, recipient DM settings, and membership are enforced by Yapper.

```js
const user = await client.users.fetch('USER_ID');
if (user) await user.send('Hello privately!');
const dm = await client.createDM('USER_ID');
await dm.send('This uses the same conversation.');
```

Receiving a DM does not require a separate message event: use `MessageCreate`
and check `message.channel?.isDMBased()`.

## Messages and message history

| Message property | Meaning |
| --- | --- |
| `id`, `channelId`, `authorId` | Stable identifiers when present |
| `content` | Text, possibly unavailable on partial records |
| `author`, `channel`, `guild`, `member` | Related cached models; can be null |
| `guildId`, `inGuild()` | Server identity / whether server context is known |
| `createdTimestamp`, `editedTimestamp` | Milliseconds; edited timestamp may be null |
| `createdAt` | Date or null |
| `replyToId`, `attachmentPath` | Existing reply/media metadata |
| `partial` | True when channel or content fields are missing |
| `reactions` | ReactionManager tied to the message |

| Method | Result |
| --- | --- |
| `reply(content)` | New Message linked to this message |
| `edit(content)` | Updated Message |
| `delete()` | This Message after successful deletion |
| `fetch()` | Fetches missing/current fields and preserves a partial message's reaction cache |
| `react(emoji)` | MessageReaction for the logged-in user's reaction |
| `createReactionCollector`, `awaitReactions` | Reaction collection helpers |
| `createReactionMenu` | Attaches controls to an existing message |
| `setReactionRoles(pairs)` | Configures emoji-to-role pairs and seeds bot reactions |

Text sends accept only a string or `{ content, replyTo }`. Content is trimmed and
must be nonempty. Unknown options, including `embeds` and `files`, throw. Editing
does not change a reply target.

```js
const channel = await client.channels.fetch('CHANNEL_ID');
if (!channel) throw new Error('Channel unavailable.');
const sent = await channel.send({ content: 'Hello', replyTo: 'MESSAGE_ID' });
await sent.edit('Updated text');
```

The live edit denial described in [Troubleshooting](troubleshooting.md#message-edit-permission-error)
can reject the final operation. Failed writes do not become successful cache edits.

History methods live on `channel.messages`:

```js
const recent = await channel.messages.fetch({ limit: 20 });
const one = await channel.messages.fetch('MESSAGE_ID');
const fresh = await channel.messages.fetch('MESSAGE_ID', { force: true });
const older = await channel.messages.fetch({ before: new Date(), limit: 50 });
```

The history limit is 1–100, default 50. `before` is a date or timestamp, not a
message ID. Results are newest first using creation time and ID. History is
scoped to the channel. An individual message fetch returns Message/null; a
history fetch returns Collection. `create`, `edit`, `delete`, and `bulkDelete`
are also exposed by MessageManager.

## Servers, members, roles, and bans

`Guild`/`Server` exposes `id`, `name`, `ownerId`, `icon`, `description`,
`discoverable`, `tags`, `tag`, `channels`, `members`, `roles`, and `bans`.
Mutating helpers are `edit`, `setName`, `setIcon`, `setDescription`,
`setDiscovery`, `setNickname`, `leave`, and `delete`.

`GuildMember` exposes server membership independently from a public User:
`id`, `guildId`, `guild`, `nickname`, `displayName`, `joinedTimestamp`, `joinedAt`,
`partial`, `user`, and `roles`. Its `user` can be null until a profile is fetched.
`guild.members` extends Collection and `.cache` returns that same manager.
`fetch()`, `setNickname()`, `timeout()`, `kick()`, and `ban()` provide member actions.

`Role` exposes identity, name, `color`, `color2`, position, raw `permissions`,
automatic-role mode/date, and cached `members`. `GuildBan` uses the banned user's
ID as `.id`; `.createdAt` can be null until an authoritative row is fetched.

The management methods, accepted options, permissions semantics, and partial
bulk-delete behavior are detailed in
[Customization and moderation](customization-and-moderation.md).

## REST and errors

| REST method | HTTP operation |
| --- | --- |
| `get(route, options?)` | GET |
| `post(route, body?, options?)` | POST |
| `patch(route, body?, options?)` | PATCH |
| `delete(route, options?)` | DELETE |
| `rpc(name, body?)` | POST to `/rest/v1/rpc/name` |
| `request(route, options?)` | Low-level method/body/header control |

Routes must start with `/auth/v1/` or `/rest/v1/`. Authentication and the public
API key are attached automatically. The caller supplies authorized endpoint
names and arguments; these methods do not discover or bypass server permissions.
Prefer high-level managers for cache updates and entity events.

| Error | Useful fields |
| --- | --- |
| `YapperError` | `message`, `code`; wrapped API failures can add sanitized `request` metadata |
| `YapperAPIError` | `status`, `method`, `route`, `code`, `retryAfter`; status 0 means network/read failure |
| `AuthenticationError` | Auth-specific `code` |
| `SessionStorageError` | `SESSION_STORAGE_FAILED` |
| `CollectorError` | `reason`, `collected` |
| `MessageBulkDeleteError` | `deleted`, `failedId`, `cause` |

API errors omit response bodies and route query values. `retryAfter` is seconds
or null. Command/menu/poll wrappers retain `request` with status, method, route,
code, and retryAfter; arbitrary application exception messages are not attached.
Handle `MessageBulkDeleteError` separately because some operations succeeded.

## More reference material

- [Commands and events](commands-and-events.md): CommandDefinition, context,
  router, and event signatures.
- [Interactions](interactions.md): reactions, collectors, menus, pagination,
  confirmation, and polling.
- [Authentication](authentication.md): session formats, store interfaces, retries.
- [Configuration](configuration.md): presence methods, timing, and defaults.
