# Contributing and releases

[Documentation index](README.md)

This guide is for people changing or publishing YapJS. Package users should
start with [Getting started](getting-started.md) and the [API reference](api.md).

## Source layout

| Path | Contents |
| --- | --- |
| `YapperJS/` | Client, managers, structures, authentication, realtime, and helpers |
| `YapperJS/index.js`, `index.mjs`, `index.d.ts` | CommonJS exports, ESM exports, and public declarations |
| `docs/` | Package usage guides and reference |
| `examples/` | Runnable applications; see [Repository examples](examples.md) |
| `test/` | Offline unit and integration tests |
| `scripts/check-package.js` | Package manifest and file allowlist verification |
| Root `package.json` | Canonical package metadata and release entry points |

The nested `YapperJS/package.json` is retained for compatibility with direct
installation of that directory. Publish the repository root to include the guides.

The project is **YapJS**, published as `@therealenvist/yapjs`. The implementation folder
keeps its legacy `YapperJS/` name so existing local imports and session paths keep
working. Repository links still point to the current GitHub repository. The
encrypted session format is unchanged, so saved sessions remain readable.

## Validate changes

Run from the repository root with Node.js 22 or newer:

```sh
npm test
npm run pack:check
```

In PowerShell, use `npm.cmd` if `npm.ps1` is blocked. The test suite uses mocked
APIs and offline pack/install checks. For changes limited to the diagnostic bot,
`npm run test:bot` provides its targeted checks.

When changing the public API, update the implementation, both module entry
points where applicable, TypeScript declarations, and relevant guides. Use
method names and defaults from the implementation, and make complete starters
usable in a separate consuming project.

Mocks check client behavior; they cannot establish that Yapper permits an
account-specific live operation. Record the status, method, route, and API code
for a live failure using [sanitized error handling](troubleshooting.md#read-errors-without-exposing-credentials).

## Review the package

```sh
npm pack --dry-run
npm pack
```

The first command lists the package contents; the second creates a `.tgz`
archive. The archive includes library JS/ESM/declarations, Markdown guides,
README, license, and package metadata. It excludes example code, tests,
`node_modules`, real `.env` files, session files, and backups.

Install that archive into another project to check it as a dependency:

```sh
npm install /path/to/therealenvist-yapjs-0.7.0.tgz
```

Use the filename for the version you packed.

## Publish a release

This package uses the `@therealenvist` npm user scope. Log in with that account
and use an unused version. With checks passing, preview and publish from the root:

```sh
npm publish --dry-run
npm login
npm whoami
npm publish --access public
```

The final command uploads a public release. Both manifests also set
`publishConfig.access` to `public`. Follow npm's authentication prompts and
[scoped publishing requirements](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).
Each subsequent release needs a new version; an existing name/version pair
cannot be overwritten. Keep the compatibility metadata consistent when bumping
versions. If you change the package name, update imports and documentation too.
