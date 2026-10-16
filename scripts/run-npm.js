'use strict';
const { existsSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = function runNpm(args, options) {
  // npm.cmd cannot be executed directly by execFileSync on Windows. Invoke the
  // JS CLI with Node so paths and arguments never need shell quoting.
  const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (existsSync(cli)) return execFileSync(process.execPath, [cli, ...args], options);
  return execFileSync('npm', args, options);
};
