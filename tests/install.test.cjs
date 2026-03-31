'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');

function run(args, cwd = REPO_ROOT) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, OXE_NO_BANNER: '1', HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', fakeHome };
}

describe('oxe-cc CLI', () => {
  test('unknown flag exits 1', () => {
    const { status, stderr } = run(['--not-a-real-flag']);
    assert.strictEqual(status, 1);
    assert.match(stderr, /Opção desconhecida/);
  });

  test('install nests workflows under .oxe and bootstraps (no oxe/ at repo root)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--oxe-only', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'quick.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'config.json')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'codebase')));
    assert.ok(!fs.existsSync(path.join(dir, 'oxe')), 'default layout must not create top-level oxe/');
  });

  test('--no-init-oxe skips .oxe bootstrap but keeps .oxe/workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--oxe-only', '--no-init-oxe', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
  });

  test('doctor passes after install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 0, d.stderr + d.stdout);
  });

  test('status exits 0 after oxe-only install and mentions próximo passo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    const s = run(['status', dir]);
    assert.strictEqual(s.status, 0, s.stderr + s.stdout);
    assert.match(s.stdout + s.stderr, /Próximo passo sugerido|próximo passo/i);
  });

  test('doctor fails without oxe/workflows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 1);
  });

  test('init-oxe creates .oxe only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['init-oxe', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'config.json')));
  });

  test('--version has no banner (single line)', () => {
    const r = spawnSync(process.execPath, [CLI, '--version'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout.trim(), /^oxe-cc v[\d.]+/);
    assert.ok(!r.stdout.includes('===='), 'banner box should not appear');
  });

  test('--copilot-cli creates ~/.claude/commands and .oxe/workflows in project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status, fakeHome } = run(['--copilot-cli', '--no-init-oxe', '--no-global-cli', '-l', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.copilot', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('uninstall --ide-only removes CLI command dirs but keeps .oxe/workflows', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = { ...process.env, OXE_NO_BANNER: '1', HOME: fakeHome, USERPROFILE: fakeHome };
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env }).status,
      0
    );
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--copilot-cli', '--no-init-oxe', '--no-global-cli', '-l', dir], {
        cwd: REPO_ROOT,
        env,
      }).status,
      0
    );
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'oxe-scan.md')));
    const u = spawnSync(process.execPath, [CLI, 'uninstall', '--ide-only', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(u.status, 0, u.stderr + u.stdout);
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'oxe-scan.md')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('uninstall removes nested .oxe/workflows from project', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = { ...process.env, OXE_NO_BANNER: '1', HOME: fakeHome, USERPROFILE: fakeHome };
    assert.strictEqual(
      spawnSync(process.execPath, [CLI, '--oxe-only', dir], { cwd: REPO_ROOT, env }).status,
      0
    );
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
    const u = spawnSync(process.execPath, [CLI, 'uninstall', '--dir', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(u.status, 0, u.stderr + u.stdout);
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'workflows', 'scan.md')));
  });

  test('--global-cli and --no-global-cli together exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const r = run(['--global-cli', '--no-global-cli', '--oxe-only', dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /Não use.*global-cli/i);
  });

  test('doctor fails on invalid .oxe/config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{ not: json', 'utf8');
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 1);
    assert.match(d.stdout + d.stderr, /JSON inválido/i);
  });

  test('--global and --local together exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const r = run(['--global', '--local', '--oxe-only', dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /Não use --global e --local/i);
  });

  test('--global --cursor installs under HOME .cursor and oxe/ at repo root', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-home-'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const env = { ...process.env, OXE_NO_BANNER: '1', HOME: fakeHome, USERPROFILE: fakeHome };
    const r = spawnSync(process.execPath, [CLI, '--cursor', '--global', '--no-init-oxe', '--no-global-cli', dir], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(fakeHome, '.cursor', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'scan.md')));
  });
});
