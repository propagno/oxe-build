'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');

describe('A21 — Zona .oxe/.cache/, fix junction NTFS precheck-ws e oxe-cc gc com retenção segura (OXB-230-21)', () => {
  it('OXB-230-21: oxe-test-precheck.cjs uses .oxe/.cache/precheck-ws and disposes worktree + NTFS junction cleanly without touching real node_modules', () => {
    const precheck = require(path.join(REPO_ROOT, 'bin/lib/oxe-test-precheck.cjs'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a21-precheck-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
      fs.mkdirSync(path.join(dir, 'node_modules', 'demo-pkg'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'demo-pkg', 'index.js'), 'module.exports = 1;\n');
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.oxe/\n');
      execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

      const ws = precheck.gitWorkspace(dir);
      const wt = ws.create();
      assert.ok(wt.replace(/\\/g, '/').includes('/.oxe/.cache/precheck-ws/'), `precheck-ws deve ficar em .oxe/.cache/precheck-ws, obteve ${wt}`);
      assert.ok(fs.existsSync(wt));

      ws.dispose(wt);
      assert.equal(fs.existsSync(wt), false, 'worktree de precheck deve ser removido no dispose');
      assert.equal(fs.existsSync(path.join(dir, '.oxe', '.cache', 'precheck-ws')), false, 'pasta pai precheck-ws vazia deve ser removida no dispose');
      assert.equal(fs.existsSync(path.join(dir, 'node_modules', 'demo-pkg', 'index.js')), true, 'node_modules real do projeto nunca pode ser tocado');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-230-21: bin/lib/oxe-gc.cjs and CLI oxe-cc gc --dry-run / --apply clean temporaries, empty dirs and stale runs/evidence while preserving active session', () => {
    const gc = require(path.join(REPO_ROOT, 'bin/lib/oxe-gc.cjs'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a21-gc-'));
    try {
      const oxe = path.join(dir, '.oxe');
      fs.mkdirSync(path.join(oxe, '.cache', 'tmp'), { recursive: true });
      fs.writeFileSync(path.join(oxe, '.cache', 'tmp', 'junk.txt'), 'x'.repeat(2048));
      fs.mkdirSync(path.join(oxe, 'tmp'), { recursive: true });
      fs.writeFileSync(path.join(oxe, 'tmp', 'legacy.txt'), 'y'.repeat(1024));
      fs.writeFileSync(path.join(oxe, 'OXE-EVENTS.jsonl'), '');
      fs.mkdirSync(path.join(oxe, 'capabilities'), { recursive: true }); // empty optional dir
      fs.mkdirSync(path.join(oxe, 'dashboard'), { recursive: true }); // empty optional dir

      // Active run + 3 older runs
      fs.mkdirSync(path.join(oxe, 'runs'), { recursive: true });
      fs.writeFileSync(path.join(oxe, 'ACTIVE-RUN.json'), JSON.stringify({ run_id: 'oxe-run-active' }));
      for (const id of ['oxe-run-active', 'oxe-run-old1', 'oxe-run-old2', 'oxe-run-old3']) {
        fs.writeFileSync(path.join(oxe, 'runs', `${id}.json`), JSON.stringify({ run_id: id }));
      }
      // Make old runs older than active
      const oldTime = new Date(Date.now() - 40 * 86400 * 1000);
      for (const id of ['oxe-run-old1', 'oxe-run-old2', 'oxe-run-old3']) {
        fs.utimesSync(path.join(oxe, 'runs', `${id}.json`), oldTime, oldTime);
      }

      // Old evidence file + fresh evidence file
      fs.mkdirSync(path.join(oxe, 'evidence'), { recursive: true });
      const oldEv = path.join(oxe, 'evidence', 'old.log');
      const freshEv = path.join(oxe, 'evidence', 'fresh.log');
      fs.writeFileSync(oldEv, 'old evidence');
      fs.utimesSync(oldEv, oldTime, oldTime);
      fs.writeFileSync(freshEv, 'fresh evidence');

      // Active session must be preserved
      fs.mkdirSync(path.join(oxe, 'sessions', 's001-demo'), { recursive: true });
      const specFile = path.join(oxe, 'sessions', 's001-demo', 'SPEC.md');
      fs.writeFileSync(specFile, '# SPEC\n');

      // 1. Dry-run via CLI does NOT delete anything
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      const dryCli = spawnSync(process.execPath, [CLI, 'gc', '--dir', dir, '--keep-runs', '1', '--max-age-days', '14', '--dry-run', '--json'], {
        cwd: REPO_ROOT,
        env: childEnv,
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(dryCli.status, 0, dryCli.stdout + dryCli.stderr);
      const dryJson = JSON.parse(dryCli.stdout);
      assert.equal(dryJson.oxeGcSchema, 1);
      assert.equal(dryJson.dry_run, true);
      assert.ok(dryJson.reclaimable_bytes > 0);
      assert.equal(fs.existsSync(path.join(oxe, 'tmp', 'legacy.txt')), true, 'dry-run não deve apagar arquivos');

      // 2. Apply via CLI cleans temporaries, empty dirs, stale runs & stale evidence while preserving active run + fresh evidence + session
      const applyRes = gc.runOxeGc(dir, { apply: true, keepRuns: 1, maxAgeDays: 14 });
      assert.equal(applyRes.ok, true);
      assert.equal(applyRes.dry_run, false);
      assert.ok(applyRes.removed_count >= 6, JSON.stringify(applyRes));
      assert.equal(fs.existsSync(path.join(oxe, 'tmp')), false);
      assert.equal(fs.existsSync(path.join(oxe, 'OXE-EVENTS.jsonl')), false);
      assert.equal(fs.existsSync(path.join(oxe, 'capabilities')), false);
      assert.equal(fs.existsSync(path.join(oxe, 'runs', 'oxe-run-active.json')), true, 'run ativa deve ser preservada');
      assert.equal(fs.existsSync(oldEv), false, 'evidência vencida em evidence/ deve ser removida');
      assert.equal(fs.existsSync(freshEv), true, 'evidência recente em evidence/ deve ser preservada');
      assert.equal(fs.existsSync(specFile), true, 'sessão ativa deve ser preservada');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
