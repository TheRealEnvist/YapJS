# Reactions, collectors, and interactions

[Documentation index](README.md)

## Ordinary reactions

```js
await message.react('✅');
await message.reactions.fetch();
const checkmark = message.reactions.cache.get('✅');
console.log(checkmark?.count, checkmark?.me);
await message.reactions.remove('✅');
```

`ReactionManager` aggregates users by emoji. Adding the logged-in user's reaction
is idempotent, including duplicate-constraint recovery. `remove()` and
`removeAll()` remove only that account's own reactions. They do not remove
another user's control clicks.

Each `MessageReaction` has `.message`, `.emoji.name`, `.count`, `.me`, and
`.users.cache`; `.users.fetch()` refreshes reaction rows first. Counts reflect
received/fetched rows and API response limits, rather than an unlimited census.
An event for an uncached message can expose a partial Message; `message.fetch()`
fills it in without dropping the reaction cache.

## Message collectors

```js
const collector = channel.createMessageCollector({
  filter: message => message.authorId === 'USER_ID',
  time: 30000,
  idle: 10000,
  max: 3,
});
collector.on('collect', message => console.log('Collected', message.id));
collector.on('end', (messages, reason) => console.log(messages.size, reason));
```

| Option | Meaning |
| --- | --- |
| `filter` | Sync/async predicate; defaults to accepting all events in scope |
| `time` | Overall lifetime in milliseconds; default 60000 |
| `idle` | Inactivity deadline, reset after each accepted collection |
| `max` | Maximum total accepted events, not unique collection keys |
| `dispose` | Reaction collectors also process removals |
| `errors` | End reasons that should reject an await helper |

Timer/max values, when supplied, are positive integers no greater than
2147483647. Unknown collector options throw. A message collector is scoped to
its channel; add an author filter to avoid collecting someone else's reply.

An await helper returns a Collection:

```js
const { CollectorError } = require('yapjs');
try {
  const replies = await channel.awaitMessages({
    filter: reply => reply.authorId === 'USER_ID',
    max: 1,
    time: 30000,
    errors: ['time'],
  });
  console.log(replies.first()?.content);
} catch (error) {
  if (!(error instanceof CollectorError)) throw error;
  console.log('No completed reply:', error.reason, error.collected.size);
}
```

Without `errors: ['time']`, a timeout resolves with whatever was collected,
including an empty Collection. Register a collector before sending a prompt if
you need to avoid missing a very fast reply. `ctx.awaitReply()` does that
collection for one same-author message; your handler still sends the prompt.

## Reaction collectors

```js
const reactions = message.createReactionCollector({
  filter: (reaction, user) => user.id === 'USER_ID',
  time: 60000,
  dispose: true,
});
reactions.on('collect', (reaction, user) => console.log(user.id, reaction.emoji.name));
reactions.on('remove', (reaction, user) => console.log('Removed', user.id));
```

Keys combine emoji and user ID. Repeated accepted additions increment `.total`
but replace the existing value for that key in `.collected`. With `dispose`,
removal deletes a collected key and emits `remove`. Reaction `count` and collector
`total` therefore measure different things.

## Collector lifecycle

| Member | Behavior |
| --- | --- |
| `collected`, `total` | Current keyed values / total accepted events |
| `ended`, `endReason` | Lifecycle state |
| `lastCollectedTimestamp` | Last accepted-event time in milliseconds |
| `finished` | Resolves to `{ collected, reason }` |
| `next` | Promise for the next accepted item; rejects if the collector ends first |
| `resetTimer({ time?, idle? })` | Restarts deadlines while still active |
| `stop(reason?)` | Stops with `user` by default |

Reasons include `time`, `idle`, `limit`, `user`, `error`, `clientDestroy`, and
applicable `messageDelete`, `channelDelete`, or `guildDelete`. Menus can also use
`selected`, `closed`, or `seedError`. Event listeners are shared through a client
hub, so adding collectors does not add a separate client listener for each one.
Deleting the relevant entity or destroying the client cleans up active collectors.

## Reaction menus

```js
const { ReactionButtonBuilder } = require('yapjs');
const menu = await channel.sendReactionMenu({
  content: 'Choose an action. Only you can use these controls.',
  allowedUserIds: ['USER_ID'],
  time: 30000,
  buttons: [
    new ReactionButtonBuilder().setCustomId('hello').setLabel('Say hello').setEmoji('👋'),
    new ReactionButtonBuilder().setCustomId('close').setLabel('Close').setEmoji('⏹️'),
  ],
  async onSelect(interaction) {
    if (interaction.customId === 'close') interaction.stop('closed');
    else await interaction.reply('Hello!');
  },
});
```

The helper sends text with a legend and seeds the bot's reactions. To use an
existing message, call `message.createReactionMenu(options)` instead; supply
your own legend if needed. Controls require a nonempty `allowedUserIds` list or
an explicit `public: true`. Bot seeding reactions are ignored.

Buttons may be plain objects with `{ customId, label, emoji, disabled? }`.
Supply 1–20 buttons, unique custom IDs and emojis, and labels no longer than 80
characters. Custom IDs contain 1–100 letters, digits, underscores, or hyphens.
`once: true` admits one selection. `filter` can further restrict an
audience. Use `onSelect` for work that must finish before a one-shot menu closes.
Ordinary EventEmitter `select` listeners are not awaited by emission.

`ReactionInteraction` exposes `customId`, `button`, `user`, `reaction`, and
`message`, with `reply()`, `update()`, and `stop()`. `update()` edits the control
message; it can fail if Yapper denies content changes. `menu.selected` holds the
last dispatched interaction. `menu.finished` resolves to the collector's result.

`menu.setDisabled(id, true)` disables local handling only. It does not change the
legend or remove an emoji. Expiry stops local handling; it does not erase the
message and reactions. Handler errors stop the menu and emit a sanitized error.

## Repeated clicks

These are Yapper emoji reactions, not native UI buttons. A user's reaction stays
set after an addition. To activate the same control again, remove that reaction
and add it again. A different arrow can be added normally. The library does not
silently remove other users' reactions to simulate repeatable button clicks.

## Confirmation

```js
const result = await channel.confirm({
  content: 'Confirm this example action?',
  allowedUserIds: ['USER_ID'],
  time: 30000,
});
if (result.confirmed) console.log('Confirmed by', result.user.id);
```

The result contains `{ confirmed, user, reason, message }`. Confirmation is true
only for an allowed confirm selection. Cancel and timeout return false. The
helper itself performs no destructive action; your application decides what a
confirmed selection means.

## Pagination

```js
const paginator = await channel.paginate(
  ['First page', 'Second page', 'Third page'],
  { allowedUserIds: ['USER_ID'], time: 60000 },
);
```

Supply 1–100 nonempty text pages. The helper creates one control message and
edits that same message when previous/next reactions are accepted. Page indexes
are clamped to the first and last pages. Close stops the menu. It does not send
replacement page replies.

If an edit fails, the displayed content remains unchanged, the menu stops, and
an error is emitted. The observed live `403/42501` permission failure therefore
blocks navigation until Yapper accepts message edits. See
[the editing troubleshooting note](troubleshooting.md#message-edit-permission-error).

## Polls

```js
const poll = await channel.createPoll({
  question: 'Best snack?',
  choices: ['Pizza', 'Tacos'],
  time: 60000,
  updateOnEnd: false,
});
const { results, reason } = await poll.finished;
console.log(reason, results.map(choice => `${choice.label}: ${choice.votes}`));
```

Polls allow 2–10 choices. Labels can be strings, or objects with `label` and an
explicit unique `emoji`. Questions are limited to 500 characters and choice
labels to 100. Polls accept users who can see/react to the message, excluding
the bot; they have no per-user audience option like menus.

One current vote is stored per user. Their latest accepted choice replaces the
previous vote, and removing that active choice removes the vote. Poll votes are
local state maintained from received events, not a durable tally replayed after
disconnects. `results()` returns current `{ label, emoji, votes }` entries.

By default, the library edits the poll message with final results. Set
`updateOnEnd: false` to handle results yourself, as in the example above. You can
store the returned results or send your own summary after `poll.finished`
resolves. This avoids an automatic content edit if your application wants a
separate result message.

## Reaction roles

```js
await message.setReactionRoles([
  { emoji: '✅', roleId: 'ROLE_ID' },
]);
```

This configures observed server emoji-to-role pairs and seeds the bot's own
reactions. Server permissions and role behavior still apply. It is distinct
from a local menu callback and does not invent a client-side permission grant.
