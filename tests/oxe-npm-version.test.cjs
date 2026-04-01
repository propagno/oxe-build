'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = require('../bin/lib/oxe-npm-version.cjs');

describe('oxe-npm-version', () => {
  test('parseNpmViewVersion plain line', () => {
    assert.strictEqual(mod.parseNpmViewVersion('0.3.5\n'), '0.3.5');
  });

  test('parseNpmViewVersion JSON quoted', () => {
    assert.strictEqual(mod.parseNpmViewVersion('"1.2.3"\n'), '1.2.3');
  });

  test('parseNpmViewVersion v prefix', () => {
    assert.strictEqual(mod.parseNpmViewVersion('v2.0.0'), '2.0.0');
  });

  test('parseNpmViewVersion invalid', () => {
    assert.strictEqual(mod.parseNpmViewVersion('not-a-version'), null);
    assert.strictEqual(mod.parseNpmViewVersion(''), null);
  });

  test('parseNpmViewVersion single-quoted line JSON.parse fallback', () => {
    assert.strictEqual(mod.parseNpmViewVersion("'not-a-semver'"), null);
  });

  test('isNewerThan', () => {
    assert.strictEqual(mod.isNewerThan('0.4.0', '0.3.5'), true);
    assert.strictEqual(mod.isNewerThan('0.3.5', '0.3.5'), false);
    assert.strictEqual(mod.isNewerThan('0.3.4', '0.3.5'), false);
  });

  test('syncNpmViewVersion uses fake npm on PATH', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oxe-fnpm-'));
    const body = `'use strict';
const v = process.env.OXE_TEST_FAKE_NPM_VERSION || '99.0.0';
if (process.argv.includes('view')) { console.log(v); process.exit(0); }
process.exit(1);
`;
    const cli = path.join(dir, 'npm-cli.js');
    fs.writeFileSync(cli, body, 'utf8');
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dir, 'npm.cmd'), `@node "${cli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(dir, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\n${body}`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const sep = path.delimiter;
    const pathEnv = dir + sep + process.env.PATH;
    const rOld = mod.syncNpmViewVersion('oxe-cc', { env: { ...process.env, PATH: pathEnv, OXE_TEST_FAKE_NPM_VERSION: '0.0.1' } });
    assert.strictEqual(rOld.ok, true);
    if (rOld.ok) assert.strictEqual(rOld.version, '0.0.1');
    const rNew = mod.syncNpmViewVersion('oxe-cc', { env: { ...process.env, PATH: pathEnv, OXE_TEST_FAKE_NPM_VERSION: '99.0.0' } });
    assert.strictEqual(rNew.ok, true);
    if (rNew.ok) assert.strictEqual(rNew.version, '99.0.0');
  });

  test('syncNpmViewVersion empty stdout yields parse error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-fnpm-empty-'));
    const body = `'use strict';
process.exit(0);
`;
    const cli = path.join(dir, 'npm-cli.js');
    fs.writeFileSync(cli, body, 'utf8');
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dir, 'npm.cmd'), `@node "${cli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(dir, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\n${body}`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const pathEnv = dir + path.delimiter + process.env.PATH;
    const r = mod.syncNpmViewVersion('oxe-cc', { env: { ...process.env, PATH: pathEnv } });
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.match(r.error, /interpretar/i);
  });

  test('syncNpmViewVersion maps non-zero npm exit to error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-fnpm-fail-'));
    const body = `'use strict';
console.error('npm view failed');
process.exit(1);
`;
    const cli = path.join(dir, 'npm-cli.js');
    fs.writeFileSync(cli, body, 'utf8');
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dir, 'npm.cmd'), `@node "${cli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(dir, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\n${body}`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const pathEnv = dir + path.delimiter + process.env.PATH;
    const r = mod.syncNpmViewVersion('oxe-cc', { env: { ...process.env, PATH: pathEnv } });
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.ok(r.error.length > 0);
  });
});
