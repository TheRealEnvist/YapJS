# Commands and events

[Documentation index](README.md)

## Register a command

The client constructs an empty router. Register commands before login so the
first incoming message can be handled.

```js
client.commands.register({
  name: 'greet',
  aliases: ['hello'],
  description: 'Greet one person',
  usage: '"display name"',
  minArgs: 1,
  maxArgs: 1,
  cooldown: 3000,
  async execute(ctx) {
    await ctx.reply(`Hello, ${ctx.args[0]}!`);
  },
});
client.commands.addHelpCommand();
```

With prefix `!`, `!hello "Amy Rose"` resolves the alias and passes
`ctx.args = ['Amy Rose']`. The command name is case-insensitive. Quoted strings,
escaped spaces, and empty quoted arguments are supported; an unclosed quote
produces `COMMAND_PARSE_ERROR`.

The parser is also available separately when you need to inspect command-like
arguments without routing a message:

```js
const { parseArguments } = require('yapjs');
console.log(parseArguments('one "two words"')); // ['one', 'two words']
```

## CommandDefinition

| Field | Meaning |
| --- | --- |
| `name` | Required; begins with a letter, then letters/digits/underscores/hyphens, at most 32 characters |
| `execute(ctx)` | Required function; may be async |
| `aliases` | Alternative names using the same name rules; cannot collide with registered names/aliases |
| `description`, `usage` | Help text; usage follows the name |
| `minArgs`, `maxArgs` | Nonnegative parsed-argument bounds |
| `cooldown` | Per-command, per-author milliseconds; overrides router default |
| `ownerOnly` | Requires author ID in configured owners |
| `guildOnly`, `dmOnly` | Restricts command context; cannot both be true |
| `authorize(ctx)` | Optional async access check |
| `hidden` | Hides a command from built-in help; does not disable it |

The help command lists commands permitted by the owner/guild/DM flags. It does
not evaluate custom `authorize` callbacks or promise that an API permission
check will succeed. Help is chunked into replies; a large command list can have
multiple help messages.

## Command context

| Member | Meaning |
| --- | --- |
| `client`, `manager`, `command` | Current client, router, and resolved definition |
| `message` | Incoming command message |
| `authorId`, `author` | Author ID and possibly-null cached User |
| `channel`, `guild` | Related cached channel/server; guild is null in DMs |
| `args` | Parsed argument array |
| `rawArgs` | Original text following the command name, with quote/escape syntax retained |
| `prefix` | Prefix that matched this message |
| `reply(content)` | Reply to the command message |
| `send(content)` | Send in the command's channel |
| `awaitReply(options)` | Collect one next message from the same author in that channel |

Use `rawArgs` for formats such as `Question | Choice A | Choice B`. Use `args`
when quoted argument grouping matters. Use `authorId` for authorization; public
profile or display-name availability is not an identity guarantee.

## Load command files

In a trusted command directory, create `greet.cjs`:

```js
module.exports = {
  name: 'greet',
  description: 'Say hello',
  async execute(ctx) { await ctx.reply('Hello!'); },
};
```

Load the directory in your bot:

```js
const path = require('node:path');
client.commands.load(path.join(__dirname, 'commands')).addHelpCommand();
```

`load()` loads direct `.js` and `.cjs` files in name order; it is not recursive.
Files are executable CommonJS modules. Do not load untrusted uploads as commands.
Loading duplicate names throws. `resolve(name)` accepts aliases;
`unregister(name)` removes the command and its aliases. Hot reloading is not
automatic; restart the launcher after editing files.

## Prefixes and routing

The prefix can be a string, array, or async function returning a string/array:

```js
const client = new Client({
  commands: {
    prefix: message => message.inGuild() ? ['!', '?'] : '!',
    cooldown: 1000,
    replyOnReject: true,
  },
});
```

The longest matching prefix is considered first. Empty prefixes are ignored.
The router ignores unknown commands, its own messages, and known bot authors
by default. It runs on new-message events, not edits. Turning off `ignoreBots`
does not enable processing the logged-in account's own messages.

The router applies context/access checks, argument bounds, and cooldowns before
execution. Cooldowns are claimed before the handler runs, so concurrent calls
by the same author do not bypass the limit. They are in-memory and reset when
the process restarts.

## Authorization

```js
client.commands.register({
  name: 'staff',
  ownerOnly: true,
  guildOnly: true,
  async authorize(ctx) { return ctx.guild.id === 'ALLOWED_SERVER_ID'; },
  async execute(ctx) { await ctx.reply('Authorized.'); },
});
```

Configure actual user IDs in `commands.owners`. An empty list permits nobody
to run owner-only commands. These are application checks; Yapper still checks
the bot account's permissions for subsequent API operations. Nicknames,
display names, and server tags do not grant bot-owner status.

With `replyOnReject: true`, cooldowns, usage mistakes, and access denials receive
short replies. With false, listen for `CommandRejected` to decide what to do.

## Command events and errors

| Event | Arguments |
| --- | --- |
| `CommandStart` | `context` |
| `CommandFinish` | `context`, after a successful handler |
| `CommandRejected` | `context`, `{ reason, retryAfter }`; retryAfter is milliseconds |
| `CommandError` | Sanitized `YapperError`, context; parse failures provide `{ message, command }` |

Rejection reasons include `ownerOnly`, `guildOnly`, `dmOnly`, `authorization`,
`args`, and `cooldown`. Handler failure returns false from `commands.handle()`;
successful execution returns true. Ignored/rejected messages also return false.

```js
const { Events } = require('yapjs');
client.on(Events.CommandError, (error, ctx) => {
  console.error(ctx.command.name, error.message);
  if (error.request) {
    console.error(error.request.status, error.request.method, error.request.route);
  }
});
```

Raw API response bodies and arbitrary application exception messages are not
attached to command errors. If you need more application context, catch and
handle an error inside your own handler. Do not echo credentials or raw request
objects into a chat reply.

## Client event reference

Use constants from `Events` rather than spelling event names manually.

| Event constant | Arguments / meaning |
| --- | --- |
| `ClientReady`, legacy `Ready` | `client`; initial login is ready |
| `Error` | Error object |
| `Warn` | Warning string |
| `Destroyed` | Local client cleanup completed |
| `MessageCreate` | `message` |
| `MessageUpdate` | `previousOrNull, message` |
| `MessageDelete` | Possibly partial `message` |
| `MessageReactionAdd`, `MessageReactionRemove` | `reaction, user` |
| `ChannelCreate`, `ChannelDelete` | `channel` |
| `ChannelUpdate` | `previousOrNull, channel` |
| `GuildCreate`, `GuildDelete` | `guild` |
| `GuildUpdate` | `previousOrNull, guild` |
| `GuildMemberAdd`, `GuildMemberRemove` | `member` |
| `GuildMemberUpdate` | `previousOrNull, member` |
| `RoleCreate`, `RoleDelete` | `role` |
| `RoleUpdate` | `previousOrNull, role` |
| `UserUpdate` | `previousOrNull, user` |
| `PresenceUpdate` | Previous and current local presence data |
| `TokenRefresh`, `SessionUpdate` | `{ expiresAt }`, after replacement credentials are saved |
| `RefreshRetry` | `{ attempt, retryIn, code, status }`; retryIn is milliseconds |
| `SessionInvalidated` | `{ code, status }`; reauthentication required |
| `GatewayReady` | Gateway authenticated and topic sync started |
| `GatewayDisconnect` | `{ code }` with WebSocket close code |
| `GatewayReconnect` | Authenticated again after a reconnect attempt |
| `TypingStart` | Authorized gateway payload |
| `Raw` | Gateway `event, payload`; may include private content |

Command events are listed separately above. See the
[declarations](../YapperJS/index.d.ts) for typed event tuples.

## Message and membership handlers

```js
client.on(Events.MessageCreate, async message => {
  if (message.authorId === client.userId) return;
  if (message.channel?.isDMBased() && message.content === '!hello') {
    await message.reply('Hello privately!');
  }
});

client.on(Events.GuildMemberAdd, member => {
  console.log('Member joined:', member.id, member.guildId);
});
```

A live `message.author` or `member.user` can be null until the public profile is
fetched. Use IDs when only identity is needed. First-contact DM channels are
loaded before queued message events are dispatched, preserving their order.
If that lookup fails, message context may remain partial.

Updates can have no prior cached object. Deletions can be partial. Member-removal
events do not distinguish a voluntary departure, kick, or ban, and do not supply
an authoritative moderator or reason. Bootstrap does not announce all historical
members as new joins.

## Gateway and delivery behavior

The gateway authenticates with the latest access token and subscribes to visible
user/server/text-channel topics. `gateway.watch(channelId)` requests an extra
channel topic; server authorization still decides whether it is allowed.
`unwatch()` removes that extra watch; an otherwise automatically watched visible
channel can remain subscribed.

After a post-login disconnect, reconnect backoff is 1, 2, 4, 8, 16, then at most
30 seconds. Reconnection authenticates using the current token. `ClientReady`
does not repeat just because the gateway reconnects.

Live events have bounded in-memory duplicate suppression. There is no automatic
history replay after a disconnect or durable exactly-once processing. For a job
that must survive interruptions, store processed message IDs yourself and
reconcile relevant history/bootstrap data after reconnecting.

The client captures rejected async listeners and reports a generic Error/Warn.
Catch inside a listener when your application needs to record its own context.
Avoid dumping `Raw`, bootstrap responses, or message payloads indiscriminately.
