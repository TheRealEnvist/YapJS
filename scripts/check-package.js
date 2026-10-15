'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'yapperjs-pack-cache-'));
try {
  const manifest = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
  const allowed = name => ['package.json', 'README.md', 'LICENSE', 'YapperJS/package.json', 'YapperJS/LICENSE'].includes(name) || /^YapperJS\/(?:[A-Za-z0-9_/-]+)\.(?:js|mjs|d\.ts)$/.test(name);
  const unexpected = manifest.files.map(file => file.path).filter(name => !allowed(name));
  if (unexpected.length) throw new Error('Unexpected package files: ' + unexpected.join(', '));
  const required = ['YapperJS/index.js', 'YapperJS/index.mjs', 'YapperJS/index.d.ts', 'YapperJS/Client.js', 'YapperJS/managers/DMManager.js', 'LICENSE'];
  if (required.some(name => !manifest.files.some(file => file.path === name))) throw new Error('Required library files are missing.');
  console.log(`Package verified: ${manifest.files.length} library, metadata and license files. No bot, examples, tests or session files.`);
} finally { fs.rmSync(cache, { recursive: true, force: true }); }
