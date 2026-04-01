'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

describe('scripts', () => {
  test('oxe-assets-scan exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'oxe-assets-scan.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
  });

  test('oxe-assets-scan exits 1 when OpenAI-style pattern in fixture tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-assets-bad-'));
    const oxeDir = path.join(root, 'oxe');
    const ghDir = path.join(root, '.github');
    const binLib = path.join(root, 'bin', 'lib');
    fs.mkdirSync(oxeDir, { recursive: true });
    fs.mkdirSync(ghDir, { recursive: true });
    fs.mkdirSync(binLib, { recursive: true });
    // Regex: sk-[a-zA-Z0-9]{20,} — fake token-shaped string (not a real secret)
    fs.writeFileSync(
      path.join(oxeDir, 'leak.md'),
      'placeholder sk-abcdefghijklmnopqrstuv not-a-real-key\n',
      'utf8'
    );
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'oxe-assets-scan.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_ASSETS_SCAN_ROOT: root },
    });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /\[oxe-assets-scan\]/);
    assert.match(r.stderr, /finding\(s\)/i);
  });

  test('sync-cursor-from-prompts exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
  });

  test('sync-cursor-from-prompts fails without .github/prompts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-'));
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /prompts ausente/i);
  });

  test('sync-cursor-from-prompts uses default description when frontmatter omits description', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-desc-'));
    const prompts = path.join(dir, '.github', 'prompts');
    const dest = path.join(dir, '.cursor', 'commands');
    fs.mkdirSync(prompts, { recursive: true });
    const raw = '---\nname: oxe-plain\n---\n\nBody only.\n';
    fs.writeFileSync(path.join(prompts, 'oxe-plain.prompt.md'), raw, 'utf8');
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = fs.readFileSync(path.join(dest, 'oxe-plain.md'), 'utf8');
    assert.match(out, /description: "Comando OXE"/);
  });

  test('sync-cursor-from-prompts handles CRLF frontmatter in prompts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-crlf-'));
    const prompts = path.join(dir, '.github', 'prompts');
    const dest = path.join(dir, '.cursor', 'commands');
    fs.mkdirSync(prompts, { recursive: true });
    const crlfFront =
      '---\r\n' +
      'name: oxe-crlf\r\n' +
      'description: Teste CRLF sync descrição rica\r\n' +
      '---\r\n' +
      '\r\n' +
      'Corpo do comando.\r\n';
    fs.writeFileSync(path.join(prompts, 'oxe-crlf.prompt.md'), crlfFront, 'utf8');
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = fs.readFileSync(path.join(dest, 'oxe-crlf.md'), 'utf8');
    assert.match(out, /description: "Teste CRLF sync descrição rica"/);
    assert.ok(out.includes('Corpo do comando.'));
  });
});
