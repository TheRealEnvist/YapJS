# YapperJS test bot

A starter bot for trying the library in server channels and private DMs. Edit
`bot.js` to add commands; it also reuses the reaction menus, polls, pagination,
collectors, and profile commands from `examples/bot/commands`.

## Try it offline

From the repository root, with Node.js 22 or newer:

```sh
npm run bot:demo
npm run test:bot
```

The demo runs the actual client and command router against an in-memory API. It
prints replies, edits, reactions, and a DM without reading `.env`, reading or
writing session files, opening sockets, or sending network requests. The tests
also check incoming events, DM failures, and saved-session restoration.

## Connect to Yapper

1. Copy `.env.example` to `.env` at the repository root if you do not have one.
2. If `YapperJS/session.json` already holds your independent bot session, it is
   restored automatically. Otherwise set `YAPPER_SESSION` to your authorized
   session JSON (single-quoted on one line), or set `YAPPER_VALUE` to your encoded
   session value. For example, replace the placeholders in:

   ```dotenv
   YAPPER_SESSION='{"access_token":"YOUR_ACCESS_TOKEN","refresh_token":"YOUR_REFRESH_TOKEN","expires_at":YOUR_EXPIRY_IN_UNIX_SECONDS}'
   YAPPER_PREFIX=!
   ```

3. Run `npm run bot`. Once the console says `Ready`, send `!help` from another
   account in a channel the bot can access, or DM it. The router ignores the bot's
   own messages. Stop with Ctrl+C.

The complete session is saved after login and token rotation. Subsequent starts
prefer that saved pair; remove first-use credentials from `.env` after successful
initialization. Do not run this bot and another client against the same session
at the same time. `YAPPER_SESSION_FILE` selects a different session file (relative
to the repository root or absolute). `YAPPER_SESSION_KEY` enables encrypted
storage and defaults to `YapperJS/session.enc.json` instead.

In Windows PowerShell, use `npm.cmd` in place of `npm` if script execution policy
blocks `npm.ps1`. There are no dependencies to install for this checkout.

## Commands

| Command | What it tests |
| --- | --- |
| `!help` | Lists available commands |
| `!ping` | Replies `Pong!` |
| `!echo Hello there` | Replies with your text |
| `!status` | Shows account, uptime, server/channel cache counts, and current context |
| `!test` | Sends and edits a bot reply, adds a checkmark reaction, reports success |
| `!dm [text]` | Sends a private test message to the person invoking it |
| `!avatar`, `!userinfo`, `!serverinfo` | Reads profile/server information |
| `!menu`, `!confirm`, `!pages` | Reaction controls, confirmations, and pagination |
| `!ask` | Collects your next reply within 30 seconds |
| `!poll Best snack? \| Pizza \| Tacos` | Runs a one-minute reaction poll |

`YAPPER_PREFIX` changes the prefix. Commands have per-user cooldowns. DM delivery
depends on account permissions and recipient settings. Moderation commands are
available in the separate `npm run example` bot.

## Use it from code

```js
const { createTestBot } = require('./examples/test-bot/bot');
const client = createTestBot({ commands: { prefix: '?' } });
client.commands.register({
  name: 'hello',
  async execute(ctx) { await ctx.reply('Hello!'); },
});
async function main() { await client.login(yourSession); }
main().catch(error => { console.error(error.message); client.destroy(); });
```

Importing the factory does not load environment files, install process handlers,
or log in. Live Yapper
delivery requires your account; the included automated checks use mocked APIs.
