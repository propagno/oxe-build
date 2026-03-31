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
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, OXE_NO_BANNER: '1' },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

describe('oxe-cc CLI', () => {
  test('unknown flag exits 1', () => {
    const { status, stderr } = run(['--not-a-real-flag']);
    assert.strictEqual(status, 1);
    assert.match(stderr, /Unknown option/);
  });

  test('install creates oxe/workflows and bootstraps .oxe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--oxe-only', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'scan.md')));
    assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'quick.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'config.json')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'codebase')));
  });

  test('--no-init-oxe skips .oxe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--oxe-only', '--no-init-oxe', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'scan.md')));
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'STATE.md')));
  });

  test('doctor passes after install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 0, d.stderr + d.stdout);
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

  test('--copilot-cli creates .claude/commands from cursor commands', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const { status } = run(['--copilot-cli', '--no-init-oxe', '--no-global-cli', '-l', dir]);
    assert.strictEqual(status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'commands', 'oxe-scan.md')));
    assert.ok(fs.existsSync(path.join(dir, 'oxe', 'workflows', 'scan.md')));
  });

  test('--global-cli and --no-global-cli together exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    const r = run(['--global-cli', '--no-global-cli', '--oxe-only', dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr + r.stdout, /Cannot use both/i);
  });

  test('doctor fails on invalid .oxe/config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cc-test-'));
    assert.strictEqual(run(['--oxe-only', dir]).status, 0);
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{ not: json', 'utf8');
    const d = run(['doctor', dir]);
    assert.strictEqual(d.status, 1);
    assert.match(d.stdout + d.stderr, /invalid JSON/i);
  });
});
