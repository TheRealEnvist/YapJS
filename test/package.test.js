'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const runNpm = require('../scripts/run-npm');
const root = path.resolve(__dirname, '..');

test('packed library excludes credentials/examples and installs with matching CommonJS/ESM exports', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yapperjs-package-test-'));
  try {
    const source = path.join(directory, 'source'), consumer = path.join(directory, 'consumer'), cache = path.join(directory, 'cache');
    await fs.mkdir(source); await fs.mkdir(consumer);
    await fs.cp(path.join(root, 'YapperJS'), path.join(source, 'YapperJS'), { recursive: true, filter: file => !/session(?:\.enc)?\.json$/.test(file) });
    await fs.cp(path.join(root, 'docs'), path.join(source, 'docs'), { recursive: true });
    for (const file of ['package.json', 'README.md', 'LICENSE']) await fs.copyFile(path.join(root, file), path.join(source, file));
    await fs.writeFile(path.join(source, 'YapperJS/session.json'), '{"refresh_token":"FAKE_PACKAGE_SECRET"}');
    await fs.writeFile(path.join(source, '.env'), 'YAPPER_SESSION=FAKE_PACKAGE_SECRET');
    await fs.mkdir(path.join(source, 'examples')); await fs.writeFile(path.join(source, 'examples/bot.js'), 'throw Error("Do not ship me");');
    const packed = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts', '--cache', cache], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
    const files = packed.files.map(file => file.path);
    for (const name of (await fs.readdir(path.join(root, 'docs'))).filter(name => name.endsWith('.md'))) assert.ok(files.includes(`docs/${name}`), `Missing documentation: ${name}`);
    assert.ok(files.includes('YapperJS/index.mjs')); assert.ok(files.includes('LICENSE')); assert.ok(!files.some(file => /session.*\.json|\.env|^(?:examples|bot|test)\//.test(file)));
    const archive = path.join(source, packed.filename);
    await fs.writeFile(path.join(consumer, 'package.json'), '{"name":"consumer-test","private":true}');
    runNpm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--cache', cache, archive], { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(await fs.readFile(path.join(consumer, 'node_modules/yapperjs/docs/README.md'), 'utf8'), /YapperJS documentation/);
    await fs.writeFile(path.join(consumer, 'smoke.cjs'), `
      const assert = require('node:assert/strict');
      globalThis.fetch = () => { throw new Error('Library import must not start requests'); };
      const before = process.listenerCount('SIGINT');
      const api = require('yapperjs');
      (async () => {
        const esm = await import('yapperjs');
        for (const key of Object.keys(api)) assert.equal(esm[key], api[key], key);
        const client = new api.Client({ realtime: false });
        assert.equal(client.isReady(), false); assert.equal(client.user, null); assert.equal(client.token, null);
        assert.equal(client.commands.cache.size, 0); assert.equal(process.listenerCount('SIGINT'), before);
        assert.equal(typeof client.sendDM, 'function'); client.destroy();
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `);
    execFileSync(process.execPath, ['smoke.cjs'], { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
