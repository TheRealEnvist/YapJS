# Repository examples

[Documentation index](README.md)

The source repository contains runnable applications that demonstrate YapperJS.
Use [Getting started](getting-started.md) to create your own application with the
installed package. This guide covers the optional repository launchers.

## Choose an example

Run repository scripts from the root folder containing `package.json`:

| Entry point | Purpose |
| --- | --- |
| `npm run bot` | Diagnostic bot with basic commands, DMs, and reaction controls; online heartbeat enabled |
| `npm run bot:demo` | Offline demonstration of that bot against an in-memory API; no account required |
| `npm run test:bot` | Offline integration tests for the diagnostic bot |
| `npm run example` | Configurable sample bot with profile settings and owner-only moderation commands |
| `node bot/bot.js` | Compatibility launcher for the configurable sample |
| `node --env-file=.env examples/private-dms.js` | Standalone DM example; replies to `!ping` in DMs |

Use Node.js 22 or newer. There are no runtime dependencies to install in this
checkout. In PowerShell, use `npm.cmd` if `npm.ps1` is blocked.

For the diagnostic bot's first live run, command reference, and manual checks,
read [Test-bot walkthrough](test-bot.md).

## Environment-variable scope

`npm run bot` and `npm run example` load the repository root `.env`. Existing
process environment values take precedence. Restart after changing settings.
These mappings belong to the launchers; ordinary package imports do not apply them.

| Variable | Diagnostic bot: `npm run bot` | Configurable sample: `npm run example` |
| --- | --- | --- |
| `YAPPER_SESSION` | First-use JSON/session input | Same |
| `YAPPER_VALUE` | First-use encoded session input | Same |
| `YAPPER_SESSION_KEY` | Enables encrypted session storage | Same |
| `YAPPER_SESSION_FILE` | Custom session path | Not read |
| `YAPPER_API_KEY` | Optional public key override | Optional public key override |
| `YAPPER_PREFIX` | Command prefix; default `!` | Command prefix; default `!` |
| `YAPPER_STATUS` | Default `online` | Presence unconfigured unless status/activity is supplied |
| `YAPPER_ACTIVITY` | Optional activity text | Optional activity text |
| `YAPPER_ENABLE_COMMANDS` | Not read; bundled commands are registered | `0` disables bundled commands |
| `YAPPER_OWNER_IDS` | Not read | Comma-separated IDs for owner-only commands |
| `YAPPER_LOG_MESSAGES` | Not read | `1` enables server-message logging |
| `YAPPER_BIO` | Not read | Optional account bio update at startup |
| `YAPPER_DISPLAY_NAME` | Not read | Optional display-name update |
| `YAPPER_CUSTOM_STATUS` | Not read | Optional custom-status text update |
| `YAPPER_PRONOUNS` | Not read | Optional pronouns update |
| `YAPPER_ACCENT_COLOR` | Not read | Optional `#RRGGBB` accent-color update |

Both launchers prefer the latest saved session to either initializer. After the
first successful login, remove the initial credentials from `.env` and retain
the session file. See [Authentication](authentication.md).

## Session paths

| Example | Default path |
| --- | --- |
| Diagnostic bot, plaintext | Repository-root `YapperJS/session.json` |
| Diagnostic bot, encrypted | Repository-root `YapperJS/session.enc.json` |
| Configurable sample | The same defaults as above |
| Standalone DM example | Working-directory `.data/yapper-session.json` |

A relative `YAPPER_SESSION_FILE` is resolved against the repository root by the
diagnostic launcher. An absolute path is used as supplied. The configurable
sample does not read that variable. The DM example reads `YAPPER_SESSION`, not
`YAPPER_VALUE`, and needs the explicit environment loader shown above. It does
not configure a presence heartbeat.

## Configure the sample bot

Edit `examples/bot/config.js`, or use the supported environment values above.
`YAPPER_ENABLE_COMMANDS=0` disables its command registration. Set
`YAPPER_OWNER_IDS` to the actual IDs of people permitted to invoke owner-only
commands; the bot account also needs the corresponding Yapper permissions.

The sample includes profile commands, server info, menus, confirmation,
pagination, collectors, polls, and moderation commands such as `!purge`,
`!timeout`, `!kick`, `!ban`, and role management. Check its help output for
available commands and usage. To implement these features in your own bot,
use [Commands and events](commands-and-events.md) and
[Customization and moderation](customization-and-moderation.md).

## Sample moderation commands

These commands belong to `npm run example`. Set `YAPPER_OWNER_IDS` to authorized
invoking account IDs. The bot account needs the corresponding Yapper server
permissions. All commands below are server-only.

| Command | Purpose |
| --- | --- |
| `!deletemessage <messageId>` | Delete one message in the current channel |
| `!purge <1-100>` | Delete recent messages in the current channel |
| `!kick <userId>` | Kick a member |
| `!ban <userId>` / `!unban <userId>` | Ban/unban |
| `!timeout <userId> <minutes> [reason]` | Apply a whole-minute timeout |
| `!nick <userId> [nickname]` | Set nickname; omit nickname to clear |
| `!role create "Role Name" [#color]` | Create a role |
| `!role edit <roleId> "Role Name" [#color]` | Rename/recolor |
| `!role delete <roleId>` | Delete role |
| `!role add <userId> <roleId>` / `!role remove <userId> <roleId>` | Assign/remove manual role |
| `!role list` | List roles and IDs |

User arguments accept raw IDs or `<@USER_ID>` mentions. `@name` strips `@` and
still means an ID, rather than a username search. Built-in help hides these
commands from authors outside the configured owner list.

## What is shipped

The npm package includes the library, declarations, and Markdown guides. The
runnable examples, mock API, and test scripts remain in the source repository.
See [Contributing](contributing.md) for repository checks and packaging.
