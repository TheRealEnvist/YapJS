# Test-bot walkthrough

[Documentation index](README.md)

The test bot is a small runnable application built on YapperJS. Its source is
`examples/test-bot/bot.js`; it reuses demonstration commands from
`examples/bot/commands`. This guide ships with the canonical library package,
but running the included bot requires the source checkout.

## Run modes

| Command | Behavior |
| --- | --- |
| `npm run bot:demo` | Simulated client/API; no account, environment file, sockets, or session-file changes |
| `npm run test:bot` | Offline tests for the bot and its integration behavior |
| `npm run bot` | Loads root `.env`, restores/initializes the session, and connects to Yapper |

In PowerShell use `npm.cmd` if script execution policy blocks `npm.ps1`. All
commands run from the repository root. There are no runtime dependencies to
install for this checkout. [Getting started](getting-started.md) covers first use.

## First live run

1. Copy `.env.example` to `.env` only if `.env` does not exist.
2. Reuse `YapperJS/session.json` if it holds your independent bot session, or
   supply `YAPPER_SESSION`/`YAPPER_VALUE` for first initialization.
3. Run `npm run bot` and wait for `Ready as ...`.
4. From a different account, send `!ping` in a visible channel or DM.
5. Send `!help` to see available commands.

To get the encoded initialization value, log in to the bot account on the web,
open developer tools, and find **`yp:1n00fw`** under the Yapper site's **Local
Storage**. Copy its complete value into `YAPPER_VALUE` in `.env`. See
[Find your bot token](authentication.md#find-your-bot-token-in-the-browser) for
the browser steps and session-handling details.

Saved sessions take precedence over environment initialization values. The
launcher saves the replacement pair after login/rotation and prefers it on the
next start. Stop with Ctrl+C, and restart after editing code or configuration.
See [Authentication](authentication.md) for encrypted files and recovery.

## Test-bot configuration

| Setting | Default / meaning |
| --- | --- |
| `YAPPER_PREFIX` | `!` |
| `YAPPER_SESSION_FILE` | Root-relative `YapperJS/session.json`, or `.enc.json` with a key; absolute paths also accepted |
| `YAPPER_SESSION_KEY` | Optional base64 32-byte encryption key |
| `YAPPER_API_KEY` | Optional public project key override |
| `YAPPER_STATUS` | `online` |
| `YAPPER_ACTIVITY` | No activity text |

The bot sends its initial presence heartbeat during login and renews it every
45 seconds. Status/activity overrides are honored. Shutdown stops the timer.
The test-bot launcher does not read the configurable example's owner IDs,
command-enable flag, profile-update variables, or message-logging flag.
[Configuration](configuration.md#environment-variable-scope) compares both launchers.

## Command reference

Cooldowns below are per command and invoking author. They begin before handler
execution and reset on process restart. Examples use the default `!` prefix.

| Command | Cooldown | Expected result |
| --- | --- | --- |
| `!help` | 1 second | List of available commands |
| `!ping` / `!pong` | 2 seconds | `Pong!` |
| `!echo <text>` | 1 second | Reply with the raw argument text |
| `!status` | 1 second | Account, uptime, cached server/channel counts, and current context |
| `!avatar` | 2 seconds | Your public avatar URL or a no-image message |
| `!userinfo` / `!me` | 2 seconds | Your display name/username, ID, and bio |
| `!serverinfo` / `!guildinfo` | 2 seconds | Server name and cached channel/member counts; server-only |
| `!test` | 10 seconds | Separate send/edit/reaction results |
| `!dm [text]` | 10 seconds | Private message sent only to the invoking author |
| `!ask` | 35 seconds | Wait for your next message for up to 30 seconds |
| `!menu` | 10 seconds | Restricted hello/close reaction controls lasting 30 seconds |
| `!confirm` | 10 seconds | Restricted confirm/cancel controls lasting 30 seconds |
| `!pages` | 10 seconds | One original message with page controls lasting up to 60 seconds |
| `!poll Question \| A \| B` | 10 seconds | Poll, followed by a separate result reply after 60 seconds |

### Basic response and profile checks

Start with `!ping`, then `!echo Hello from YapperJS`. `!echo` preserves raw argument
text, including matched quote syntax; the router still validates balanced quotes.
`!status` reports cached counts, so those numbers do not establish a full server
membership census or socket health.

`!avatar` and `!userinfo` force-fetch your public profile. The avatar response is
a URL rather than an uploaded attachment or embed. A cached/auth profile and a
fresh public profile may contain different account flags.

### Message test

`!test` sends a test reply, attempts to edit it, tries a checkmark reaction even
if editing fails, then replies with a summary. A normal successful summary is:

```text
Send: OK
Edit: OK
Reaction: OK
Try !dm to test private messages.
```

The observed live edit denial produces `Edit: failed (Yapper API 403 (42501))`
while reaction success is still reported independently. It is not a claim that
editing works. If the initial send itself fails, normal command-error handling
logs the failure and attempts a generic error reply.

### Private messages

`!dm hello` sends `hello` to you, not to an arbitrary user named by the argument.
Without text, it sends a default test message inviting you to try `!ping` in that
DM. In a server channel it acknowledges successful delivery. When invoked in a
DM, it does not add a redundant server-style acknowledgement.

The command handles blocked/restricted DM creation by replying with a short
settings/permissions message. Yapper's normal DM restrictions remain in effect.

### Message collection

Run `!ask`, wait for the prompt, and send an answer in the same channel from the
same account. The bot replies `You said: ...`, or reports no reply after 30
seconds. Other authors/channels are excluded. Initial arguments such as
`!ask hi` are ignored; `hi` must be a subsequent message to be collected.

### Menu and confirmation

Only the invoking author can activate these controls. The bot's own seeded
reactions are ignored. `!menu`'s hello action can reply more than once when you
remove and re-add the wave reaction. Close stops the collector. `!confirm`
admits one confirm/cancel selection and reports the outcome or timeout.

The visible reaction icons are not native buttons. Their counts include the
bot's seeded reaction. The icons remain after controls expire.

### Pages

`!pages` creates one message containing page one and previous/next/close
reactions. Successful navigation edits that message in place. To use the same
arrow twice, remove and re-add your reaction. The bot does not send new messages
for page navigation.

An edit rejection leaves the current content visible, closes the menu, and logs
the error. The observed Yapper-side profile permission issue prevents live
navigation until content edits are accepted. Re-running `!pages` creates a new
menu; it does not restore an old collector.

### Polls

```text
!poll Best snack? | Pizza | Tacos
```

Provide a question and 2–10 nonempty choices separated by `|`. The poll is open
to other users who can react, with one current vote per user. The most recently
accepted choice counts. Removing that active choice removes the vote. After a
minute the command posts results as a reply; it does not rely on editing the
poll message. Deleting the relevant message/channel/server or stopping the bot
suppresses that result reply.

## Add your own command

The factory is exported and does not connect, load `.env`, or install process
handlers when imported. In another script in this checkout:

```js
const { createTestBot } = require('./examples/test-bot/bot');

const client = createTestBot({
  commands: { prefix: '?', owners: ['YOUR_USER_ID'] },
  presence: { status: 'online', activity: 'Trying custom commands' },
});
client.commands.register({
  name: 'hello',
  description: 'Say hello',
  async execute(ctx) { await ctx.reply('Hello!'); },
});
```

Then initialize it with an application-owned store and call `login()`, as in
[the complete starter](getting-started.md#complete-commonjs-starter). Calling
`createTestBot()` already registers built-in help and demo commands; do not
register a duplicate `help` name.

`startTestBot({ env, ...clientOptions })` is an alternative programmatic entry
point: it selects a store, prefers its saved session, logs in, and returns the
client. It does not itself load `.env` or install shutdown handlers; the direct
CLI entry does those jobs. Supply a dedicated `sessionStore` or
`env.YAPPER_SESSION_FILE` for an independent running bot.

## Files to edit

| File | Responsibility |
| --- | --- |
| `examples/test-bot/bot.js` | Factory, diagnostic commands, logging, session startup, CLI |
| `examples/test-bot/demo.js` | Offline scripted demonstration |
| `examples/test-bot/mock-api.js` | In-memory API for demo and tests |
| `examples/bot/commands/*.js` | Shared profile and reaction/collector commands |
| `test/test-bot.test.js` | Offline integration checks |

The mock API intentionally fails unsupported requests rather than falling back
to the network. Add a new mock route when testing a new capability; do not
remove the isolation to make a test pass. Changes to shared command files also
affect `npm run example`.

## Troubleshoot a test run

Start with [Troubleshooting](troubleshooting.md), especially the edit-permission
note, repeated-reaction behavior, saved-session precedence, and PowerShell npm
launcher. Console errors now contain safe status/method/endpoint/API-code
details. The offline tests cover intended behavior, including failures; use a
live account only for the operations you intend to exercise.
