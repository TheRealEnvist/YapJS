# YapJS test bot

A starter bot for trying the library in server channels and private DMs. Edit
`bot.js` to add commands; it also reuses the reaction menus, polls, pagination,
collectors, and profile commands from `examples/bot/commands`.

To build your own bot with the installed YapJS package, start with
[Getting started](../../docs/getting-started.md). This README covers the optional
repository test bot.

For the full command walkthrough and extension reference, read
[the test-bot guide](../../docs/test-bot.md). Start at
[the documentation index](../../docs/README.md) for the library's complete API,
authentication, configuration, event, and troubleshooting guides.

## Contents

- [Try it offline](#try-it-offline)
- [Connect to Yapper](#connect-to-yapper)
- [Find your bot token](#find-your-bot-token)
- [Configuration reference](#configuration-reference)
- [Online presence](#online-presence)
- [Commands](#commands)
- [Manual test sequence](#manual-test-sequence)
- [Message editing and reaction controls](#message-editing-and-reaction-controls)
- [Use it from code](#use-it-from-code)
- [Project layout and checks](#project-layout-and-checks)

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

## Find your bot token

1. Log in to the bot's account on the Yapper website.
2. Open developer tools with **F12** or **Ctrl+Shift+I** on Windows.
3. In Chrome/Edge, open **Application → Local Storage**. In Firefox, open
   **Storage → Local Storage**. Select the Yapper site's origin.
4. Find the key **`yp:1n00fw`** and copy its entire **Value**, not the key name.
5. Paste that encoded value into the repository root `.env` file:

   ```dotenv
   YAPPER_VALUE='PASTE_THE_COMPLETE_yp:1n00fw_VALUE_HERE'
   ```

6. Close the bot account's Yapper browser tabs, then run `npm run bot` or
   `npm.cmd run bot`. Do not run both clients against the same session.

This value is the account's encoded session and contains credentials. Keep it
private; no manual decoding is needed. After the first successful login, remove
the initialization value from `.env` and use the saved session. Existing saved
sessions take precedence, and a nonempty `YAPPER_SESSION` also takes precedence
over `YAPPER_VALUE`.

See [the authentication walkthrough](../../docs/authentication.md#find-your-bot-token-in-the-browser)
if the key is missing or you need details about session storage and recovery.

## Configuration reference

| Variable | Test-bot behavior |
| --- | --- |
| `YAPPER_SESSION` | Authorized first-use session JSON; a saved session takes precedence |
| `YAPPER_VALUE` | Alternative encoded initialization value |
| `YAPPER_SESSION_FILE` | Custom root-relative or absolute session path |
| `YAPPER_SESSION_KEY` | Optional base64 32-byte key; switches to encrypted storage |
| `YAPPER_API_KEY` | Optional override of the bundled public project key |
| `YAPPER_PREFIX` | Command prefix, default `!` |
| `YAPPER_STATUS` | Presence status, default `online` |
| `YAPPER_ACTIVITY` | Optional activity text |

The test-bot launcher does not read `YAPPER_ENABLE_COMMANDS`, `YAPPER_OWNER_IDS`,
profile-update variables, or `YAPPER_LOG_MESSAGES`. Those belong to the separate
`npm run example` launcher. Read the
[environment scope table](../../docs/examples.md#environment-variable-scope)
before copying settings between launchers. Restart to apply environment changes.

## Online presence

The bot sends an online heartbeat immediately after login and renews it every
45 seconds while running. Shutdown stops the heartbeat timer. This uses the
library's presence manager and the saved rotating session.

`YAPPER_STATUS` overrides the default `online` status; `YAPPER_ACTIVITY` sets
optional activity text. For example:

```dotenv
YAPPER_STATUS=online
YAPPER_ACTIVITY=Testing commands
```

## Commands

| Command | Cooldown | What it tests |
| --- | --- | --- |
| `!help` | 1s | Lists available commands |
| `!ping` / `!pong` | 2s | Replies `Pong!` |
| `!echo Hello there` | 1s | Replies with the raw argument text |
| `!status` | 1s | Account, uptime, cached counts, and current context |
| `!test` | 10s | Send, edit, and reaction results independently |
| `!dm [text]` | 10s | Sends a private test message only to the invoking author |
| `!avatar` | 2s | Force-fetches your profile and sends its avatar URL |
| `!userinfo` / `!me` | 2s | Force-fetches your display name, ID, and bio |
| `!serverinfo` / `!guildinfo` | 2s | Server name and cached counts; server-only |
| `!menu` | 10s | Hello/close reaction controls for 30 seconds |
| `!confirm` | 10s | A one-selection confirm/cancel prompt for 30 seconds |
| `!pages` | 10s | Page changes by editing one message; controls last up to 60 seconds |
| `!ask` | 35s | Collects your next reply within 30 seconds |
| `!poll Best snack? \| Pizza \| Tacos` | 10s | One-minute reaction poll with a separate result reply |

`YAPPER_PREFIX` changes the prefix. Commands have per-user cooldowns. DM delivery
depends on account permissions and recipient settings. Moderation commands are
available in the separate `npm run example` bot.

## Manual test sequence

1. Send `!ping` from another account and check the reply.
2. Run `!avatar` and `!userinfo` to exercise public profile fetching. An avatar
   reply is a URL; an inline image preview depends on the Yapper UI.
3. Run `!dm hello`, open the DM, and send `!ping` there. DM privacy settings can
   block delivery; the command reports that case without exposing API bodies.
4. Run `!ask`, wait for the prompt, then reply from the same account/channel.
   `!ask hi` does not use `hi` as the collected answer.
5. Try `!menu` and `!confirm`. Only the invoking account can use those controls.
   The visible emoji counts include the bot's own seeded reactions.
6. Run `!test` and read each result separately. A failed edit does not mean the
   reaction check was skipped.
7. Try `!pages` after checking the editing limitation below. It never posts a
   replacement page; a failed edit stops that menu.
8. Run a poll, vote, and wait one minute for the result reply. Reactions and
   collector state are local and are not replayed after disconnects.

Console failures include sanitized HTTP details when available. See
[Troubleshooting](../../docs/troubleshooting.md) for startup, storage, presence,
permissions, repeated reactions, and partial model data.

## Message editing and reaction controls

Live checks found that Yapper can reject a message content edit with `403/42501`
and `permission denied for table profiles`, even when the bot is editing its own
reply. That server-side permission error needs a Yapper-side fix. `!test` reports
the edit failure and continues testing reactions instead of claiming every test
passed.

`!pages` edits its original message to show the selected page. If Yapper denies
the edit, the original page remains visible, the menu stops, and the console logs
the error. It does not post additional page messages. Live navigation therefore
requires Yapper to resolve the message-edit permission error above. Remove and
re-add your reaction to press the same arrow twice. Controls expire after one
minute. Poll results are posted as a separate reply.

Command/menu failures now log the HTTP status, API code, method, and endpoint
when available. For example, `403 ... PATCH /rest/v1/messages ... (42501)` gives
useful diagnostic context without printing tokens or private API response bodies.

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

`yourSession` above represents an authorized session you supply. In a real
application, prefer an application-owned session store as shown in
[the complete starter](../../docs/getting-started.md#complete-commonjs-starter).
The factory has already registered built-in help; do not add another `help` name.

`startTestBot({ env, ...clientOptions })` selects a store, restores/initializes the
session, logs in, and returns the client. When used programmatically it does not
load `.env` or install shutdown handlers; the direct CLI entry does those jobs.

Importing the factory does not load environment files, install process handlers,
or log in. Live Yapper delivery requires your account; the included automated
checks use mocked APIs.

## Project layout and checks

| File | Purpose |
| --- | --- |
| `bot.js` | Factory, diagnostic commands, log handlers, session startup, CLI |
| `demo.js` | Offline scripted demonstration |
| `mock-api.js` | In-memory HTTP API; unsupported routes fail locally |
| `../bot/commands/` | Shared sample commands; changes also affect `npm run example` |
| `../../test/test-bot.test.js` | Bot integration and failure-path checks |

Run `npm run test:bot` for targeted checks, `npm test` for the full offline suite,
and `npm run pack:check` to verify delivery contents. The canonical package ships
the library and `docs/`, while runnable example code remains checkout-only.
