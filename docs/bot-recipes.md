# Common bot recipes

[Documentation index](README.md)

These examples use the **YapJS package in your own project**. Start with
[Getting started](getting-started.md) to install `yapjs`, obtain your session, and
set up `.env`, `.gitignore`, and persistent login.

| Build | Example |
| --- | --- |
| Greet new server members | [Complete welcome bot](#complete-welcome-bot) |
| Answer common questions | [FAQ and rules commands](#faq-and-rules-commands) |
| Send help privately | [Private help command](#private-help-command) |
| Let members vote | [Quick poll command](#quick-poll-command) |
| Publish staff announcements | [Owner-only announcements](#owner-only-announcements) |
| Show a user's avatar | [Avatar command](#avatar-command) |

The welcome bot is a complete program. The other recipes are additions to the
`client` in the [starter](getting-started.md#complete-commonjs-starter): insert
them **before `main()` calls `login()`**. Add each command once. The starter's
`!help` will include them automatically.

## Complete welcome bot

This bot posts a greeting in one server channel whenever someone joins that
server. It also provides `!ping` to check that the bot responds.

### Configure it

The bot account must already belong to the server and have access to send in the
welcome channel. Add these values to your bot project's `.env`:

```dotenv
YAPPER_VALUE='PASTE_YOUR_ENCODED_SESSION_HERE'
WELCOME_SERVER_ID=YOUR_SERVER_ID
WELCOME_CHANNEL_ID=YOUR_WELCOME_TEXT_CHANNEL_ID
```

Use actual IDs, not names or invite codes. If your client UI does not expose an
ID, you can print the servers and channels visible to the logged-in bot once:

```js
client.once(Events.ClientReady, ready => {
  console.table(ready.guilds.cache.map(guild => ({ id: guild.id, name: guild.name })));
  console.table(ready.channels.cache.map(channel => ({
    id: channel.id, name: channel.name, serverId: channel.guildId,
  })));
});
```

Add that listener to your working starter before login. These are cached records
visible to the bot. Choose a text channel in the intended server.

### Write `welcome.cjs`

```js
const path = require('node:path');
const { Client, Events, FileSessionStore } = require('yapjs');

const store = new FileSessionStore(path.join(__dirname, '.data/session.json'));
const client = new Client({
  sessionStore: store,
  presence: { status: 'online', activity: 'Welcoming members' },
  commands: { prefix: '!', replyOnReject: true },
});

const serverId = process.env.WELCOME_SERVER_ID;
const channelId = process.env.WELCOME_CHANNEL_ID;

client.on(Events.Error, error => console.error(error.message));
client.once(Events.ClientReady, ready => {
  console.log(`Welcome bot ready as ${ready.user.username || ready.userId}`);
});

client.on(Events.GuildMemberAdd, async member => {
  if (member.guildId !== serverId || member.id === client.userId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.guildId !== serverId || !channel.isTextBased()) {
      throw new Error('WELCOME_CHANNEL_ID must be a text channel in WELCOME_SERVER_ID.');
    }
    await channel.send(`Welcome, ${member.displayName}! Please read the pinned messages and say hello.`);
  } catch (error) {
    console.error('Could not send the welcome message:', error.message);
  }
});

client.commands.register({
  name: 'ping',
  description: 'Check whether the welcome bot responds',
  async execute(ctx) { await ctx.reply('Pong!'); },
});
client.commands.addHelpCommand();

process.once('SIGINT', () => client.destroy());
process.once('SIGTERM', () => client.destroy());

async function main() {
  if (!serverId || !channelId) throw new Error('Set WELCOME_SERVER_ID and WELCOME_CHANNEL_ID in .env.');
  const saved = await store.load();
  const initial = process.env.YAPPER_SESSION || process.env.YAPPER_VALUE;
  if (!saved && !initial) throw new Error('Set YAPPER_VALUE for the first login.');
  await client.login(saved ?? initial);
}

main().catch(error => {
  console.error(error.message);
  client.destroy();
  process.exitCode = 1;
});
```

### Run and customize

```sh
node --env-file=.env welcome.cjs
```

Send `!ping` from another account, then have an account join the configured
server while the bot is connected. Existing members are not greeted on startup.
Edit the `channel.send()` text to change the greeting.

The stored session and heartbeat work as in the starter. Remove the first-use
credential from `.env` after successful initialization. **Run either this bot or
the starter against that session, one process at a time.** Both examples use
`.data/session.json` in the script's directory.

`member.displayName` uses a cached nickname/profile when available and falls back
to the user's ID. Realtime joins are best-effort: events missed while disconnected
are not replayed. A welcome message therefore is not a guaranteed audit record.
See [membership events](commands-and-events.md#message-and-membership-handlers).

## FAQ and rules commands

Add these commands to your starter. Replace the text with your community's
actual rules and support instructions.

```js
const answers = {
  rules: 'Be respectful, stay on topic, and read the pinned channel guidelines.',
  support: 'Ask in the support channel and include the steps that caused the problem.',
};

client.commands.register({
  name: 'faq',
  description: 'Answer a common question',
  usage: '<rules|support>',
  minArgs: 1,
  maxArgs: 1,
  cooldown: 2000,
  async execute(ctx) {
    const answer = answers[ctx.args[0].toLowerCase()];
    await ctx.reply(typeof answer === 'string' ? answer : 'Available topics: rules, support.');
  },
});

client.commands.register({
  name: 'rules',
  description: 'Show the server rules',
  cooldown: 2000,
  async execute(ctx) { await ctx.reply(answers.rules); },
});
```

Try `!faq support`, `!faq rules`, or `!rules`. Unknown topics receive the list of
supported topics. With `replyOnReject: true`, `!faq` by itself receives usage help.

## Private help command

This command sends information to the person who invoked it, then acknowledges
delivery in the channel. It works from a server channel or DM.

```js
client.commands.register({
  name: 'guide',
  description: 'Receive a private getting-started guide',
  cooldown: 10000,
  async execute(ctx) {
    try {
      await ctx.client.sendDM(ctx.authorId, 'Welcome! Start with !rules, then ask a question in the support channel.');
    } catch {
      await ctx.reply('I could not send you a DM. Check your DM settings and try again.');
      return;
    }
    if (!ctx.channel?.isDMBased()) await ctx.reply('I sent you a private guide.');
  },
});
```

Try `!guide`, then open the DM. Recipient settings, blocks, or account permissions
can prevent delivery. Use [the DM API](api.md#channels-and-direct-messages) to
customize the private message.

## Quick poll command

This creates a 30-second poll in the current server channel. It posts the results
as a separate message, so it does not depend on editing the poll message.

```js
client.commands.register({
  name: 'vote',
  description: 'Vote on the next community activity',
  guildOnly: true,
  cooldown: 30000,
  async execute(ctx) {
    const poll = await ctx.channel.createPoll({
      question: 'What should we do next?',
      choices: ['Game night', 'Movie night', 'Q&A'],
      time: 30000,
      updateOnEnd: false,
    });
    const { results, reason } = await poll.finished;
    if (reason !== 'time') return;
    await ctx.send('Results:\n' + results.map(choice => `${choice.label}: ${choice.votes}`).join('\n'));
  },
});
```

Try `!vote`, react with an option, and wait 30 seconds. Each user's latest accepted
choice counts as their vote. Votes are collected from live events while the bot
is connected. See [poll behavior](interactions.md#polls) for limits and options.

## Owner-only announcements

First add the user IDs permitted to publish announcements to the starter's
`commands` options when constructing the client:

```js
const client = new Client({
  sessionStore: store,
  presence: { status: 'online' },
  commands: {
    prefix: '!',
    owners: ['YOUR_USER_ID'],
    replyOnReject: true,
  },
});
```

Replace the starter's constructor with that configuration; do not create a second
client. Then register:

```js
client.commands.register({
  name: 'announce',
  description: 'Publish an announcement in this channel',
  usage: '<text>',
  ownerOnly: true,
  guildOnly: true,
  minArgs: 1,
  cooldown: 10000,
  async execute(ctx) { await ctx.send(`Announcement:\n${ctx.rawArgs}`); },
});
```

Try `!announce Game night starts at 7 PM!` from an allowed account. Other users
are rejected, and the command cannot run in DMs. The bot still needs permission
to send in the current channel. Owner IDs are application settings, independent
of server ownership; see [authorization](commands-and-events.md#authorization).

## Avatar command

Fetch the invoking user's current public profile and reply with their avatar URL:

```js
client.commands.register({
  name: 'avatar',
  description: 'Show your current avatar',
  cooldown: 2000,
  async execute(ctx) {
    const user = await ctx.client.users.fetch(ctx.authorId, { force: true });
    const url = user?.displayAvatarURL();
    await ctx.reply(url || 'You do not have an avatar set.');
  },
});
```

Try `!avatar`. The URL is sent as text; any inline preview is provided by the
Yapper UI. This recipe does not upload a file or build an embed.
