# YapperJS

A dependency-free Node.js 22+ client with a discord.js-style API for Yapper.

```js
const path = require('node:path');
const { Client, Events, FileSessionStore } = require('./YapperJS');

const client = new Client({
  sessionStore: new FileSessionStore(path.join(__dirname, 'YapperJS/session.json')),
});

client.once(Events.ClientReady, readyClient => {
  console.log(`Ready as ${readyClient.user.username}`);
});
client.on(Events.Error, error => console.error(error.message));

client.on(Events.MessageCreate, async message => {
  if (message.authorId === client.user.id) return;
  if (message.content === '!ping') await message.reply('Pong!');
});

async function main() { await client.login(); }
main().catch(error => { console.error(error.message); client.destroy(); });
```

Run `npm test` for the offline test suite. Run `npm start` to connect the sample
bot using the existing `YapperJS/session.json`. The sample loads `.env` using Node's built-in loader, connects, and enables the
example text commands. Set `YAPPER_ENABLE_COMMANDS=0` to disable them. Configure
`YAPPER_PREFIX` (default `!`) and `YAPPER_OWNER_IDS` in .env or bot/config.js.
No npm dependencies are needed to run the library or tests.

## Login and rotation

`client.login()` restores the configured session store. You can also pass a decoded
session object, its JSON string, the encoded `yp:1n00fw` value, or an object containing
only a `refresh_token`. Use your own independent authorized login session. Yapper's
public project API key is included; `apiKey` or `YAPPER_API_KEY` overrides it if the
site rotates that key.

```js
await client.login({ access_token, refresh_token, expires_at });
// Or initialize using an encoded value without committing it to source:
await client.login(process.env.YAPPER_VALUE);

const latest = await client.auth.getSession(); // Contains credentials: keep private.
await client.auth.refresh();                    // Explicit rotation, normally automatic.
```

A session stays in memory by default. Automatic refresh runs before expiry and
shares a single exchange across concurrent callers. The complete replacement pair
is saved before authenticated requests use it or token events fire. If storage fails,
requests are blocked until persistence works again. Token events contain only
`{ expiresAt }`, not credentials. `destroy()` closes sockets and timers and clears
in-memory credentials; it does not sign out or erase persisted sessions.

Do not run separate processes/browser clients against one refresh-token chain.
The refresh lock is per Client instance. Create a separate authorized session for
each independently running client. HTTP rotation and a storage write cannot be one
transaction: if a process dies after rotation but before saving, reauthentication
may be needed. Supabase recovery exceptions are not a persistence guarantee.

## Persistence

`FileSessionStore` preserves compatibility with the existing session.json. It stores
plaintext credentials with owner-only file permissions and replaces the file using
an atomic rename. File permissions are not encryption. Session files, temporary
files, backups and environment files are excluded by .gitignore.

For encrypted local persistence, keep a separate random 32-byte key outside the file:

```js
const { Client, EncryptedFileSessionStore } = require('./YapperJS');
const client = new Client({
  sessionStore: new EncryptedFileSessionStore(
    './YapperJS/session.enc.json',
    process.env.YAPPER_SESSION_KEY // Base64-encoded 32-byte encryption key.
  ),
});
await client.login(initialSession); // On first use; subsequently client.login().
```

Encrypted storage uses AES-256-GCM with a random nonce and authentication tag. It
rejects wrong keys or tampered files. It does not silently import a plaintext file.
The example bot selects this store when YAPPER_SESSION_KEY is set. To initialize
it, supply your own session through YAPPER_SESSION or YAPPER_VALUE; thereafter omit
those inputs so the latest persisted token pair is loaded. Losing the key loses
access to the saved credentials; create a fresh login session rather than deriving
a predictable encryption key.

For an OS vault or a server secret store, provide this interface:

```js
const sessionStore = {
  async load() { /* Return a decoded session object, or null. */ },
  async save(session) { /* Replace the complete saved session; throw on failure. */ },
  async clear() { /* Optional: remove only this client's saved session. */ },
};
```

## Familiar objects and managers

```js
client.user;                        // Current User.
client.users.cache;                 // Collection<string, User>.
client.channels.cache;              // Collection<string, Channel>.
client.guilds.cache;                // Collection<string, Guild>.
client.servers === client.guilds;    // Yapper calls these servers.

const channel = await client.channels.fetch(channelId);
const sent = await channel.send('Hello');
await sent.reply('A reply');
await sent.edit('Updated');
await sent.delete();

const history = await channel.messages.fetch({ limit: 20 });
const message = await channel.messages.fetch(messageId);
const older = await channel.messages.fetch({ before: new Date(), limit: 50 });
const user = await client.users.fetch(userId);
await user.send('Direct message'); // Creates/gets the DM, then sends.

const general = client.channels.cache.find(c => c.name === 'general');
const textChannels = client.channels.cache.filter(c => c.isTextBased());
const names = textChannels.map(c => c.name);
```

`fetch(id)` returns a cached object unless `{ force: true }` is supplied. A missing
record returns null. `fetch()` returns the existing manager cache;
`fetch(undefined, { force: true })` fetches visible records. Servers and DM channels
are initially hydrated from the bootstrap response. `guild.channels.cache` is a
filtered view; `guild.members` contains users available in the bootstrap cache,
with `{ id }` placeholders for profiles not yet loaded. Profiles are fetched lazily;
a live message's `author` may be null until its profile is fetched. Use `authorId`
when only identity is needed. Message caches default to 200 records per channel;
change `messageCacheMaxSize` to adjust this bound. Other caches reflect the bootstrap
or explicitly fetched visible entities.

Only plain text and `{ content, replyTo }` message options are implemented. Unknown
options throw. Attachments, embeds, Discord intents, slash commands, native Discord components,
permissions wrappers, role management, voice, and full discord.js compatibility are outside
this initial implementation. `before` is a date/timestamp, not a Discord snowflake.
Message deletion currently removes the database message; attachment cleanup is not
implemented. The server enforces permissions and content/rate limits.

## Events and realtime

Available names are exported through `Events`:

- `ClientReady`, legacy `Ready`, `Error`, `Warn`, `Destroyed`.
- `MessageCreate(message)`, `MessageUpdate(oldMessage, message)`, `MessageDelete(message)`.
- `ChannelCreate`, `ChannelUpdate`, `ChannelDelete`.
- `GuildCreate`, `GuildUpdate`, `GuildDelete`, `UserUpdate`.
- `SessionUpdate({ expiresAt })`, `TokenRefresh({ expiresAt })`.
- `GatewayReady`, `GatewayDisconnect({ code })`, `GatewayReconnect`.
- `Raw(event, payload)` for authorized gateway events.

On updates the previous object can be null if it was not cached. Deleted messages
can be partial. `Raw` may contain private message content: do not dump it into logs.
Async listener rejections are caught and reported through Error/Warn with a generic
message. Handle errors inside your own listener when you need application context.

The gateway uses Yapper's observed `wss://rt.yapper.website/ws` protocol: auth with
the latest access token, then subscription to user/server/text-channel topics.
Server authorization still controls which subscriptions are accepted. Connections
retry with backoff after disconnect and reconnect with a fresh token after rotation.
Call `client.gateway.watch(channelId)` for an additional channel topic, or use
`realtime: false` for REST-only clients.

Live events are best-effort; automatic history replay after reconnect is not
implemented. Refetch history/bootstrap after a disconnect when your application
needs reconciliation. Keep your own processed-message IDs for durable exactly-once
work; the client's bounded duplicate filter is in-memory only.

## Text commands

The example bot loads command files from `bot/commands`. Start it, then try:

- `!help`, `!ping`, `!avatar`, `!userinfo`, and `!serverinfo`.
- `!menu` for labeled emoji controls, `!confirm` for a confirmation prompt.
- `!pages` for pagination and `!ask` for a message collector.
- `!poll Best snack? | Pizza | Tacos` for a one-minute reaction poll.

Commands are enabled by default in the example bot. `YAPPER_PREFIX` changes the
prefix; `YAPPER_ENABLE_COMMANDS=0` disables command registration. The old
YAPPER_ENABLE_PING switch is replaced by the command system. The example loads
.env automatically without adding a runtime dependency; real .env contents are
not read by tests or included in this package.

Register a command directly:

```js
client.commands.register({
  name: 'greet',
  aliases: ['hello'],
  description: 'Greet someone',
  usage: '"display name"',
  minArgs: 1,
  maxArgs: 1,
  cooldown: 3000, // Milliseconds, per command and author.
  async execute(ctx) {
    await ctx.reply(`Hello, ${ctx.args[0]}!`);
  },
});
client.commands.addHelpCommand();
```

The router handles aliases, case-insensitive command names, quoted arguments,
escaped spaces, cooldowns, and help. It ignores its own messages and cached bot
profiles by default. Unknown commands are ignored. It processes new-message
events, not message edits. Command context supplies client, message, authorId,
author, channel, guild, args, rawArgs, prefix, reply(), send(), and awaitReply().
`rawArgs` retains the original text after the command name.

`client.commands.load(directory)` registers exported CommonJS command objects
from .js/.cjs files. Load only your own trusted code. `resolve(name)` and
`unregister(name)` handle aliases. Prefixes can be strings, arrays, or async
functions returning a string/array. Manager options can be supplied through
`new Client({ commands: { prefix: '!', owners: ['your-user-id'], cooldown: 1000 } })`.
The library constructs an empty router; only the example bot registers commands.

Commands can specify ownerOnly, guildOnly, dmOnly, minArgs/maxArgs, hidden, and
an async authorize(ctx) callback. Owner-only commands require an explicit owner
ID in the configured owners list; there is no inferred trust from display names.
Use `YAPPER_OWNER_IDS` for the example bot. Server/API permissions still apply.
No destructive management commands are bundled.

```js
client.commands.register({
  name: 'private',
  ownerOnly: true,
  guildOnly: true,
  async authorize(ctx) { return ctx.guild?.id === permittedServerId; },
  async execute(ctx) { await ctx.reply('Authorized.'); },
});
```

Events.CommandStart and CommandFinish receive context; CommandRejected receives
context and `{ reason, retryAfter }`; CommandError receives a generic YapperError
and context (parse failures provide message/command instead of parsed context).
Application exceptions are not echoed into chat or attached to public errors.
`replyOnReject: true` enables short rejection/usage/cooldown replies; it defaults
false in the library and true in the example bot.

## Reactions and collectors

```js
await message.react('✅');
await message.reactions.fetch();
const thumbs = message.reactions.cache.get('👍');
console.log(thumbs?.count);
await message.reactions.remove('✅');
await message.reactions.removeAll();

client.on(Events.MessageReactionAdd, (reaction, user) => {
  // reaction.emoji.name, reaction.message, user.id.
});
client.on(Events.MessageReactionRemove, (reaction, user) => {});
```

ReactionManager aggregates users by emoji. add()/react() are idempotent for the
logged-in user's reaction, including a duplicate-constraint recovery fetch.
remove()/removeAll() remove only the bot's own reactions. Moderation-style removal
of other users' reactions is not assumed. Reactions on uncached messages expose a
partial Message; `await reaction.message.fetch()` loads it while retaining the
reaction cache. Counts reflect rows received live or returned by fetch(); API response limits
still apply, so they are not guaranteed complete totals for very large messages. An ID-only deletion can be resolved only when
that reaction record is still in the client's bounded lookup index.

```js
const collector = channel.createMessageCollector({
  time: 30000,
  idle: 10000,
  max: 3,
  filter: message => message.authorId === userId,
});
collector.on('collect', message => console.log(message.id));
collector.on('end', (messages, reason) => console.log(messages.size, reason));

const replies = await channel.awaitMessages({
  filter: message => message.authorId === userId,
  max: 1,
  time: 30000,
  errors: ['time'],
});

const reactions = message.createReactionCollector({
  filter: (reaction, user) => user.id === userId,
  time: 60000,
  dispose: true,
});
reactions.on('collect', (reaction, user) => {});
reactions.on('remove', (reaction, user) => {});
```

Collectors support async filters, time/idle deadlines, max accepted events,
next, resetTimer(), stop(), and a finished promise. Defaults expire after one
minute. awaitMessages()/awaitReactions() return Collections; an end reason listed
in errors rejects with CollectorError, including collected items. The reaction
collection key is emoji plus user ID, so repeated accepted clicks increment total
while the latest per-user/emoji entry replaces the previous collected value.
With dispose, removal deletes the collected entry and emits remove. A shared hub
uses one client listener per event, even with many collectors. Collectors stop on
client destruction or applicable message/channel/server deletion events. Events
remain best-effort during disconnects; collectors do not provide durable replay.

## Reaction controls, confirmations and pagination

These controls use labeled text plus ordinary Yapper emoji reactions. They do not
create Discord's native component buttons, interactions, slash commands or modals.
They are local bot helpers driven by live reactions.

```js
const { ReactionButtonBuilder } = require('./YapperJS');
const menu = await channel.sendReactionMenu({
  content: 'Choose an action',
  allowedUserIds: [userId],
  time: 60000,
  buttons: [
    new ReactionButtonBuilder().setCustomId('yes').setLabel('Yes').setEmoji('✅'),
    new ReactionButtonBuilder().setCustomId('no').setLabel('No').setEmoji('❌'),
  ],
  async onSelect(interaction) {
    await interaction.reply(`You selected ${interaction.customId}`);
    interaction.stop('selected');
  },
});
```

Use message.createReactionMenu(options) to attach controls to an existing message.
Menus require allowedUserIds, or an explicit `public: true`. They ignore the bot's
own seeding reactions. `once: true` admits only one selection; controls have unique
emojis and customIds. setDisabled(id, true) disables handling locally; it does not
remove the emoji or automatically edit the legend. Handlers run in sequence.
ReactionInteraction has customId, button, user, reaction, message, reply(), update(),
and stop(). There is no fake defer/reply acknowledgement API. Errors close the menu
and report a generic error. Controls stop accepting input on timeout/deletion/destroy.

Yapper keeps a user's reaction until they toggle it off. To press the same control
again, remove and re-add that reaction. The bot does not silently remove someone
else's reactions. Pagination therefore uses normal toggling behavior rather than
promising native repeatable button clicks. Expiry does not erase the message or its
reactions; the collector simply stops handling them.

```js
const answer = await channel.confirm({
  content: 'Continue?', allowedUserIds: [userId], time: 30000,
});
if (answer.confirmed) { /* Perform only the intended authorized action. */ }

const paginator = await channel.paginate(
  ['First page', 'Second page', 'Third page'],
  { allowedUserIds: [userId], time: 60000 },
);
```

Confirm returns `{ confirmed, user, reason, message }`. Timeout/cancel returns false.
Pagination supplies previous/next/close reactions and clamps page bounds.
Use the explicit async onSelect option when a menu action must complete before a
one-shot menu closes; ordinary async 'select' event listeners follow EventEmitter
semantics and are not awaited by emission.

## Polls and reaction roles

```js
const poll = await channel.createPoll({
  question: 'Best snack?', choices: ['Pizza', 'Tacos'], time: 60000,
});
poll.on('vote', (user, emoji) => {});
const { results, reason } = await poll.finished;
```

Polls are open to users who can see/react to the message, support 2–10 options,
ignore the bot's seed reactions, and keep one current vote per user. The user's
latest added choice wins. Removing that active reaction removes their vote; earlier
reactions do not automatically become active again. Poll state lives in memory
and counts events received while running. It does not survive restarts or replay
missed events. At expiry/stop it edits the message with totals, unless updateOnEnd
is false or the message/channel/client is gone. This helper uses emoji reactions,
not Yapper's separate native poll UI.

```js
await message.setReactionRoles([
  { emoji: '✅', roleId: memberRoleId },
]);
```

Reaction roles use Yapper's observed set_reaction_roles RPC, then seed the emojis.
The server performs role assignment/removal and checks management permissions.
An empty array clears the mapping. This is a real permission-changing operation
when explicitly invoked; it is never run automatically by the example bot or tests.
If seeding fails after the RPC succeeds, the mapping may already exist: fetch or
inspect it rather than blindly repeating operations.

`channel.sendTyping()` sends the observed gateway typing packet when connected;
for server channels the topic must have been acknowledged. DM recipients come
from bootstrap membership. It returns false when disconnected or the needed
subscription/membership is missing. Events.TypingStart receives the raw typing
payload; no unverified user/timestamp field mapping is assumed.

## Profile and presence customization

Edit `bot/config.js` to configure the example bot, or set the corresponding
YAPPER_BIO, YAPPER_DISPLAY_NAME, YAPPER_CUSTOM_STATUS, YAPPER_PRONOUNS,
YAPPER_ACCENT_COLOR, YAPPER_STATUS, and YAPPER_ACTIVITY environment variables.
Fields omitted from the configuration leave the account alone. Configured profile
fields are applied after login; presence can also be supplied in Client options.

The logged-in user is a `ClientUser` with self-editing methods:

```js
await client.user.setBio('A helpful Yapper bot');
await client.user.setDisplayName('Community Helper');
await client.user.setCustomStatus('Here to help'); // Profile text; null clears it.
await client.user.setPronouns('they/them');
await client.user.setAccentColor('#5865f2');
await client.user.edit({ bio: 'Updated bio', displayName: 'Helper' });

await client.user.setStatus('dnd');
await client.user.setActivity('Helping the community');
await client.user.setPresence({ status: 'online', activity: { name: 'Answering questions' } });
await client.user.setActivity(null); // Clears activity.
await client.user.setStatus('offline'); // One offline heartbeat; stops renewal.
```

Supported statuses are online, idle, dnd, invisible, and offline. Status/activity
are separate from custom status text. Presence uses Yapper's `heartbeat` RPC and
renews every 45 seconds after it is explicitly configured. Set `presenceInterval`
(in milliseconds, at least 1000) to customize renewal. `client.destroy()` stops the
timer without issuing another status request. Without a configured presence, login
does not start heartbeat requests. `Events.PresenceUpdate` receives old and new
`{ status, activity }` objects only after the API accepts a change.

```js
const client = new Client({
  sessionStore,
  presence: { status: 'online', activity: 'Helping out' },
});
```

Profile edits allow username, bio, displayName, pronouns, customStatus, accentColor,
accentColor2, avatar, and banner. Bio is limited to 190 characters, custom status
to 80, and usernames to 2–32 letters, digits, dots or underscores, matching Yapper's
published client. Longer values are rejected locally rather than silently truncated.
Colors accept six-digit hex values or null. Avatar/banner accept existing storage
paths or null to clear; these methods do not upload files. Other accounts' User
objects have no edit method. Server-side entitlement checks, validation and
permissions still apply to all profile fields.

## Server and channel management

These calls change the live server when you explicitly execute them. They are not
run by the sample bot or by tests. Use servers where your account has the required
management permissions. Do not expose these methods through unrestricted public
chat commands.

```js
const guild = await client.guilds.fetch(serverId);
if (!guild) throw new Error('Server unavailable');

const channel = await guild.channels.create({ name: 'bot-logs', type: 'text' });
const voice = await guild.channels.create({ name: 'Voice Chat', type: 'voice' });
await channel.setName('activity-logs');
await channel.setNoImages(true);
await channel.setPosting({ readOnly: true, roleIds: [moderatorRoleId], slowmode: 10 });
await channel.setAccess({ private: true, roleIds: [moderatorRoleId] });

// Permanent deletion: invoke only for the specific channel you intend to remove.
await channel.delete();
// Equivalent manager methods:
await guild.channels.edit(channelId, { name: 'renamed' });
await guild.channels.delete(channelId);
await guild.channels.setPositions([firstChannelId, secondChannelId]);

await guild.setName('My Community');
await guild.setIcon(null); // Clear the icon; a storage path uses an existing image.
await guild.setDescription('A new community description');
await guild.setDiscovery({ discoverable: false, description: 'Private community', tags: [] });
await guild.setNickname(client.user, 'Helper');

const createdGuild = await client.guilds.create({ name: 'New Community' });
// Explicit destructive operations, never called automatically:
await createdGuild.delete();
// await guild.leave();
```

`client.servers` aliases `client.guilds`. The top-level channel manager supports
`client.channels.create({ guildId, name, type })`, edit and delete. Guild channel
managers reject channels from another server; server-channel edit/delete reject
DMs. Names are normalized as in Yapper's client: text-channel whitespace becomes
hyphens; voice-channel names retain spaces. Only text and voice creation is
implemented. Topic editing is not exposed because no matching mutation was verified.

For posting settings, readOnly is required; roleIds defaults to [] and slowmode
(in seconds) defaults to 0. Supply all settings you want to retain. For access,
private is required, and roleIds defaults to []. Do not mistake these methods for
partial patches: they send complete settings to the corresponding RPC. After
access/posting changes the channel is fetched again; if the update removes your
visibility, the follow-up fetch can fail even though the mutation succeeded.

Changing server description/discovery fetches existing settings first and preserves
unspecified visibility and tags. Renaming a server preserves its latest icon. Server
deletion/leave evicts its associated cached channels and members after a successful
RPC; channel deletion evicts only the deleted channel after a matching returned ID.
Denied/failed writes leave caches intact. Creation is followed by a fetch; if that
fetch fails, the server may already have created the resource. Reconcile by fetching
visible servers/channels instead of blindly repeating a create call.

## REST and errors

`client.rest.get/post/patch/delete` and `client.rest.rpc(name, args)` provide access
to authenticated `/rest/v1/` routes. Requests time out after 15 seconds (configurable
through `requestTimeout`), reject HTTP failures, and never follow redirects with
credentials. A GET receiving 401 refreshes/retries once. Mutating requests are
never automatically replayed, so failed sends do not create duplicate messages
through library retries. Rate limits surface as YapperAPIError with status and,
when supplied as seconds by the API, retryAfter. No response bodies or request
credentials are attached to errors.

## Existing code

```js
const Yapper = require('./YapperJS/yapper.js');
const client = await Yapper.create(encodedValue, publicApiKey, true);
await client.refreshToken(); // Old client.refreshToken(client) also remains accepted.
```

The legacy factory stays REST-only. Its true flag still loads/saves the existing
session.json, preferring the newest stored session over an old encoded value.
`token`, `refreshtoken`, `refresh_token`, `userId` and `botProfile` remain available.
New code should use `Client`, `client.user`, and a deliberate session store. The
library itself does not log credentials or noisy login warnings. Type declarations
in YapperJS/index.d.ts provide editor completions for the new public API.

## Verification and protocol sources

Tests use fake credentials, HTTP responses, WebSockets and temporary session files.
They do not connect to your account, rotate its tokens, or send messages. Real HTTP
refresh, the live gateway, and real message writes have not been integration-tested.
Yapper's private implementation can change independently of this library.

The implementation was checked against Yapper's publicly deployed client:

- [Auth and storage](https://www.yapper.website/_next/static/immutable/chunks/34bh1hch7_wil.js).
- [Bootstrap and gateway](https://www.yapper.website/_next/static/immutable/chunks/2e101t-_0mtzf.js).
- [Messages and DM operations](https://www.yapper.website/_next/static/immutable/chunks/3ulyrb0qt9gwk.js).
- [discord.js API inspiration](https://discord.js.org/docs/packages/discord.js/main).

## Server events

Register listeners before `client.login()` and leave realtime enabled (the default).
Events are emitted for activity delivered to this account's authorized gateway
subscriptions. Bootstrap only fills caches; it does not announce existing members
as new joins. Offline activity is not replayed by this library.

```js
client.on(Events.GuildMemberAdd, member => {
  console.log(`${member.displayName} joined ${member.guild.name}`);
});
client.on(Events.GuildMemberRemove, member => {
  console.log(`${member.displayName} left or was removed from ${member.guild.name}`);
});
client.on(Events.GuildMemberUpdate, (before, member) => {
  console.log(`Nickname: ${before?.nickname ?? '(uncached)'} -> ${member.nickname}`);
});
client.on(Events.MessageCreate, message => {
  if (!message.inGuild()) return;
  console.log(message.guildId, message.member?.displayName, message.content);
});
client.on(Events.MessageUpdate, (before, message) => { /* edited message */ });
client.on(Events.MessageDelete, message => { /* removed message */ });
client.on(Events.GuildCreate, guild => { /* newly visible server */ });
client.on(Events.GuildDelete, guild => { /* deleted server or this account removed */ });
client.on(Events.ChannelCreate, channel => { /* channel added */ });
client.on(Events.ChannelUpdate, (before, channel) => { /* channel changed */ });
client.on(Events.ChannelDelete, channel => { /* channel removed */ });
```

`guild.members` is now a `GuildMemberManager` containing `GuildMember` objects;
`guild.members.size`, `.get()`, iteration, and Collection helpers still work.
Use `guild.members.cache.get(userId)`, `member.user` for the profile,
`member.nickname`, `member.joinedAt`, `member.displayName`, and `member.guild`.
`await guild.members.fetch(userId, { force: true })` reads one authorized member;
`await guild.members.fetch()` returns the current cache, without fetching a full
server list. A missing profile gives `member.user === null`; fetch it with
`client.users.fetch(member.id)` if needed. An uncached removal can have
`member.partial === true`; an uncached update has `before === null`.

Member INSERT/UPDATE/DELETE records use the observed `server_id` and `user_id`
compound key. Duplicate inserts, identical cached updates, and repeated removals
are suppressed. A delete does not distinguish leaving from kicking/banning, and
supplies no moderator or reason. Removing this account also clears the server's
channels and emits `guildDelete`; its own join refreshes the visible bootstrap
before `guildCreate`/`guildMemberAdd`. Previously cached members are not reannounced.
Message edits/deletions may be partial if the original was never cached.

The sample `bot/events.js` logs membership/server changes. Set
`YAPPER_LOG_MESSAGES=1` to log server messages too. Set `events.welcomeChannels`
in `bot/config.js` to a map of server IDs to welcome channel IDs to enable
welcome/goodbye messages; no announcements are sent without that map. Channels
must belong to the corresponding server. Edit these handlers to add your own
behavior. Keep the existing command router for text commands.

Validated with mocked gateway/HTTP payloads based on Yapper's deployed public
scripts; delivery has not been tested against a live account.

## Moderation and roles (v0.6)

These actions use the logged-in account's existing server permissions. Yapper
checks access and role hierarchy on the server. A role's `permissions` property
is its raw Yapper permission map, not a calculation of effective permissions or
Discord permission bits. API denials throw `YapperAPIError`; failed actions do
not remove cached members, messages, roles, or bans.

```js
const guild = client.guilds.cache.get('SERVER_ID');
const channel = guild.channels.resolve('CHANNEL_ID');

// Delete a single message in this channel, or up to 100 recent messages.
await channel.messages.delete('MESSAGE_ID');
await channel.bulkDelete(10);
// Explicit IDs, Message arrays, and Collections are accepted too.
await channel.bulkDelete(['MESSAGE_ID_1', 'MESSAGE_ID_2']);

// Create a role, then edit its permissions and appearance.
const role = await guild.roles.create({
  name: 'Moderators', color: '#55aaff', manageMessages: true,
});
await role.edit({ name: 'Community Moderators', color: '#aabbcc' });
await role.setPermissions({ manage_messages: true, kick_members: true, ban_members: true });
await guild.roles.fetch();
await guild.roles.setPositions(['HIGHEST_ROLE_ID', 'NEXT_ROLE_ID']);
// await role.delete();

const member = await guild.members.fetch('USER_ID');
await member.roles.add(role);
await member.roles.remove(role);
await member.setNickname('New nickname');
await member.setNickname(null); // Clear the nickname.
await member.timeout(10 * 60_000, 'Repeated spam'); // Milliseconds, whole minutes.
// await member.kick();
// await member.ban();

// ID-based methods also work when the member is not cached.
// await guild.members.kick('USER_ID');
// await guild.members.ban('USER_ID');
// await guild.bans.create('USER_ID');
// await guild.bans.remove('USER_ID');
const bans = await guild.bans.fetch();
const ban = await guild.bans.fetch('USER_ID');
console.log(ban?.user?.username, ban?.createdAt);
```

Check that `guild`, `channel`, and `member` exist in your own handlers before
using them. The examples above are a method reference; run only the actions you
intend. `guild.roles.cache`, `member.roles.cache`, and `guild.bans.cache` are
Collections. `role.members` contains cached members with that role, including
automatic cosmetic roles. Manual role assignments hydrate from bootstrap and
update from `member_roles` gateway events. Automatic roles derive from the role
mode and member's join time and cannot be manually assigned/removed with this API.

Creation accepts `name`, `color`, `position`, `manageServer`, and `manageMessages`,
matching the public client's insert. Editing also accepts `color2`, `permissions`,
`auto` (`none`, `all`, or `before`), and `autoBefore`. Use an ISO date or Date for
`autoBefore`; the `before` mode needs a date. Colors are `#RRGGBB` or null.
Role edits preserve unspecified fields. `role.setPermissions(map)` replaces the
explicit permission map and clears the two legacy `manageServer`/`manageMessages`
flags so old broad grants do not remain. `role.edit({ permissions: map })` leaves
those flags alone unless supplied. Role/ban list reads paginate and scope every
page to the selected server. Reorder IDs are highest first, matching Yapper's UI.

Successful local role writes emit `roleCreate`, `roleUpdate`, or `roleDelete`;
matching gateway echoes are suppressed. Role assignments and nickname changes
emit `guildMemberUpdate`. Successful kicks/bans emit `guildMemberRemove` when
that server is cached; matching removals are suppressed. Successful message
deletions immediately emit `messageDelete` and stop affected collectors.
Server events still do not identify a moderator or distinguish a voluntary leave
from a kick/ban. Newly created ban records have no authoritative `createdAt`
until fetched. Ban lists expose `user_id` and `created_at`; reasons/audit logs and
Discord-style deletion-of-message-history options are not implemented by the
observed ban/kick RPCs. Only the timeout call accepts a reason.

Batch deletion is sequential, not atomic. On failure it stops and throws
`MessageBulkDeleteError`, with `.deleted` (a Collection of confirmed deletions),
`.failedId`, and `.cause`. Do not repeat the whole batch after a partial failure.
Message deletion does not clean up uploaded attachment objects. Timeouts accept
positive whole-minute milliseconds; the server may apply additional duration
limits. Clearing timeouts is not exposed because the public client does not show
a verified clearing call. Mutations are not automatically replayed.

### Sample moderation commands

The sample bot registers these commands when commands are enabled. Only IDs in
`YAPPER_OWNER_IDS` can invoke them; an empty owner list allows nobody. The bot
account must also have the relevant server permissions. Commands are server-only.

| Command | Action |
| --- | --- |
| `!deletemessage <messageId>` | Delete a message in the current channel |
| `!purge <1-100>` | Delete recent messages in the current channel, including the command if present |
| `!kick <userId>` | Kick a member |
| `!ban <userId>` / `!unban <userId>` | Ban or unban a user |
| `!timeout <userId> <minutes> [reason]` | Time out a member |
| `!nick <userId> [nickname]` | Change nickname; omit nickname to clear |
| `!role create "Role Name" [#color]` | Create a role |
| `!role edit <roleId> "Role Name" [#color]` | Rename/recolor a role |
| `!role delete <roleId>` | Delete a role |
| `!role add <userId> <roleId>` / `!role remove <userId> <roleId>` | Assign/remove a role |
| `!role list` | List roles and IDs |

User arguments accept raw user IDs or `<@USER_ID>` mentions. `@name` removes the
leading `@` and still means an ID, not a username lookup. The examples assume the
default `!` prefix. These commands live in the sample bot's moderation registrar;
edit them to change behavior. `!help` shows them only to configured bot owners.

Endpoint mappings were checked against Yapper's public
[server/role implementation](https://www.yapper.website/_next/static/immutable/chunks/3dckh8r_6oh4b.js)
and [message implementation](https://www.yapper.website/_next/static/immutable/chunks/3ulyrb0qt9gwk.js).
Moderation was tested using mocked API/gateway responses, not live destructive
operations on an account.
