'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkVerifyRepo(prefix = 'oxe-1222-a2-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });

  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = { ok: () => true };\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), [
    '---',
    'oxe_doc: spec',
    'status: approved',
    '---',
    '# SPEC',
    '## Critérios de aceite',
    '| ID | Critério | Risco | Como verificar |',
    '|---|---|---|---|',
    '| A1 | noisy check passes | P1 | `node -e "console.log(\'x\'.repeat(12000))"` |',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    tasks: [
      {
        id: 'T1',
        title: 'app ok',
        wave: 1,
        files: ['src/app.js'],
        acceptance: ['A1'],
        verify: { commands: ['node -e "console.log(\'x\'.repeat(12000))"'] },
      },
    ],
    acceptance_tests: [
      { criterion: 'A1', command: 'node -e "console.log(\'x\'.repeat(12000))"', files: [] },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n## Onda 1\n### T1 — app ok\n- **Verificar:**\n  - Comando: `node -e "console.log(\'x\'.repeat(12000))"`\n- **Aceite vinculado:** A1\n');

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  execFileSync(process.execPath, [BIN, 'runtime', 'compile', '--dir', dir], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A2 — OXB-222-02: Compact JSON output by default for verify, plan lint, and status', () => {
  it('OXB-222-02: runtime verify --json is compact by default, writes verify-full.json, and supports --full/--summary', () => {
    const dir = mkVerifyRepo();

    const compactRes = spawnSync(process.execPath, [BIN, 'runtime', 'verify', '--json', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(compactRes.status, 0, compactRes.stderr || compactRes.stdout);
    assert.ok(Buffer.byteLength(compactRes.stdout, 'utf8') < 4096, `default runtime verify --json must be < 4 KB, got ${Buffer.byteLength(compactRes.stdout, 'utf8')} bytes`);

    const compactJson = JSON.parse(compactRes.stdout);
    assert.equal(compactJson.compact, true);
    assert.equal(compactJson.status, 'passed');
    assert.ok(compactJson.run_id, 'must include run_id');
    assert.ok(compactJson.checks_summary && compactJson.checks_summary.pass >= 1, 'must include checks_summary');
    assert.equal(typeof compactJson.coverage_percent, 'number');
    assert.equal(typeof compactJson.tampered, 'boolean');
    assert.ok(Array.isArray(compactJson.failures), 'must include failures array');
    assert.ok(compactJson.full_report_path, 'must include full_report_path');

    const fullPath = path.isAbsolute(compactJson.full_report_path)
      ? compactJson.full_report_path
      : path.join(dir, compactJson.full_report_path);
    assert.ok(fs.existsSync(fullPath), `verify-full.json must be written at ${fullPath}`);
    const fullDisk = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    assert.ok(fullDisk.report && fullDisk.run && fullDisk.projected, 'verify-full.json must hold complete payload');

    // --summary works as explicit compact alias (without requiring --json)
    const summaryRes = spawnSync(process.execPath, [BIN, 'runtime', 'verify', '--summary', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(summaryRes.status, 0, summaryRes.stderr || summaryRes.stdout);
    const summaryJson = JSON.parse(summaryRes.stdout);
    assert.equal(summaryJson.compact, true);
    assert.equal(summaryJson.status, 'passed');

    // --full restores the complete payload on stdout
    const fullRes = spawnSync(process.execPath, [BIN, 'runtime', 'verify', '--json', '--full', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(fullRes.status, 0, fullRes.stderr || fullRes.stdout);
    assert.ok(Buffer.byteLength(fullRes.stdout, 'utf8') > 4096, '--full must include full raw stdout payload');
    const fullStdout = JSON.parse(fullRes.stdout);
    assert.ok(fullStdout.run && fullStdout.report && fullStdout.projected, '--full must return raw run/report/projected');
  });

  it('OXB-222-02: status --json and plan lint --json default to compact output with --full opt-in', () => {
    // status --json on this product_package repo must omit raw releaseReadiness.manifest by default
    const statusCompact = spawnSync(process.execPath, [BIN, 'status', '--json', '--dir', REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(statusCompact.status, 0, statusCompact.stderr);
    const sCompact = JSON.parse(statusCompact.stdout);
    assert.equal(sCompact.compact, true);
    if (sCompact.releaseReadiness) {
      assert.equal(sCompact.releaseReadiness.manifest, undefined, 'default status --json must omit raw releaseReadiness.manifest');
    }

    const statusFull = spawnSync(process.execPath, [BIN, 'status', '--json', '--full', '--dir', REPO_ROOT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(statusFull.status, 0, statusFull.stderr);
    const sFull = JSON.parse(statusFull.stdout);
    assert.notEqual(sFull.compact, true);
    assert.ok(Buffer.byteLength(statusFull.stdout, 'utf8') > Buffer.byteLength(statusCompact.stdout, 'utf8'));

    // plan lint --json compact vs --full
    const dir = mkVerifyRepo('oxe-1222-a2-lint-');
    const lintCompact = spawnSync(process.execPath, [BIN, 'plan', 'lint', '--json', '--no-precheck', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.ok(lintCompact.status === 0 || lintCompact.status === 1);
    const lCompact = JSON.parse(lintCompact.stdout);
    assert.equal(lCompact.compact, true, 'plan lint --json must be compact by default');

    const lintFull = spawnSync(process.execPath, [BIN, 'plan', 'lint', '--json', '--full', '--no-precheck', '--dir', dir], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.ok(lintFull.status === 0 || lintFull.status === 1);
    const lFull = JSON.parse(lintFull.stdout);
    assert.notEqual(lFull.compact, true, 'plan lint --json --full must emit uncompacted payload');
  });
});
