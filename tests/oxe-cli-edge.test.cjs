'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const { isolatedHomeEnv } = require('./isolated-home-env.cjs');

describe('oxe-cc CLI edge', () => {
  test('install --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /oxe-cc|Instalação/i);
  });

  test('uninstall --help exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('update --dry-run exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /simulação|npx/i);
  });

  test('doctor missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'doctor', path.join(os.tmpdir(), 'oxe-nope-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('status missing dir exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'status', path.join(os.tmpdir(), 'oxe-nope2-xyz')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('status --json prints valid JSON with nextStep', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-st-json-'));
    const oxe = path.join(dir, '.oxe');
    const codebase = path.join(oxe, 'codebase');
    fs.mkdirSync(codebase, { recursive: true });
    const maps = [
      'OVERVIEW.md',
      'STACK.md',
      'STRUCTURE.md',
      'TESTING.md',
      'INTEGRATIONS.md',
      'CONVENTIONS.md',
      'CONCERNS.md',
    ];
    for (const f of maps) {
      fs.writeFileSync(path.join(codebase, f), '# ok\n', 'utf8');
    }
    fs.writeFileSync(path.join(oxe, 'STATE.md'), '## Fase atual\n\n`scan_complete`\n', 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const j = JSON.parse(line);
    assert.strictEqual(j.oxeStatusSchema, 1);
    assert.ok(typeof j.nextStep === 'string');
    assert.ok(Array.isArray(j.artifacts));
    assert.ok(j.diagnostics && typeof j.diagnostics === 'object');
    assert.ok(Array.isArray(j.diagnostics.planWarnings));
  });

  test('init-oxe exits 1 when target path does not exist without dry-run', () => {
    const missing = path.join(os.tmpdir(), `oxe-init-miss-${Date.now()}`);
    assert.ok(!fs.existsSync(missing));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', missing], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_NO_PROMPT: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /não encontrado/i);
  });

  test('init-oxe --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-init-'));
    const r = spawnSync(process.execPath, [CLI, 'init-oxe', '--dry-run', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 0);
  });

  test('--config-dir with --all-agents exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(
      process.execPath,
      [CLI, '--all-agents', '--config-dir', fakeHome, '--oxe-only', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
  });

  test('uninstall --ide-local with --config-dir exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cd2-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h2-'));
    const r = spawnSync(
      process.execPath,
      [CLI, 'uninstall', '--ide-local', '--config-dir', fakeHome, '--dir', dir],
      { cwd: REPO_ROOT, encoding: 'utf8', env: isolatedHomeEnv(fakeHome) }
    );
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /config-dir|ide-local/i);
  });

  test('uninstall unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'uninstall', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update unknown flag exits 1', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--nope'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update --check --dry-run exits 1 (conflito)', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /inválid|check|dry-run/i);
  });

  test('update --check --if-newer exits 1 (conflito)', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check', '--if-newer'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1' },
    });
    assert.strictEqual(r.status, 1);
  });

  test('update --check com OXE_UPDATE_SKIP_REGISTRY sai 2', () => {
    const r = spawnSync(process.execPath, [CLI, 'update', '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_UPDATE_SKIP_REGISTRY: '1' },
    });
    assert.strictEqual(r.status, 2);
  });

  test('update --if-newer com OXE_UPDATE_SKIP_REGISTRY sai 2', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-upd-skip-'));
    const r = spawnSync(process.execPath, [CLI, 'update', '--if-newer', '--dir', proj], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_NO_BANNER: '1', OXE_UPDATE_SKIP_REGISTRY: '1' },
    });
    assert.strictEqual(r.status, 2);
  });

  test('update --if-newer sai 0 sem npx quando npm latest é mais antigo', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-upd-if-'));
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-npm-cli-'));
    const body = `'use strict';
const v = process.env.OXE_TEST_FAKE_NPM_VERSION || '0.0.1';
if (process.argv.includes('view')) { console.log(v); process.exit(0); }
process.exit(1);
`;
    const npmCli = path.join(fakeBin, 'npm-cli.js');
    fs.writeFileSync(npmCli, body, 'utf8');
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(fakeBin, 'npm.cmd'), `@node "${npmCli.replace(/\\/g, '\\\\')}" %*\r\n`, 'utf8');
    } else {
      const npmBin = path.join(fakeBin, 'npm');
      fs.writeFileSync(npmBin, `#!/usr/bin/env node\n${body}`, 'utf8');
      fs.chmodSync(npmBin, 0o755);
    }
    const pathEnv = fakeBin + path.delimiter + process.env.PATH;
    const r = spawnSync(process.execPath, [CLI, 'update', '--if-newer', '--dir', proj], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        OXE_NO_BANNER: '1',
        PATH: pathEnv,
        OXE_TEST_FAKE_NPM_VERSION: '0.0.1',
      },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Nenhuma versão mais nova|npm latest/i);
  });

  test('install --dry-run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-dr-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-h-'));
    const r = spawnSync(process.execPath, [CLI, '--dry-run', '--oxe-only', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedHomeEnv(fakeHome),
    });
    assert.strictEqual(r.status, 0);
  });
});
