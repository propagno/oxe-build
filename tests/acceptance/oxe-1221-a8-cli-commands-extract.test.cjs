'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'oxe-cc.js');
const OPS_MODULE = path.join(ROOT, 'bin', 'lib', 'commands', 'ops-commands.cjs');
const BASELINE_OXE_CC_LINES = 10669;

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkGitRepo(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  execFileSync('git', ['init', '-b', 'main'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: d, stdio: 'ignore' });
  fs.writeFileSync(path.join(d, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: d, stdio: 'ignore' });
  return d;
}

describe('A8 (OB-32 / OXB-221-08): extracted CLI commands in bin/lib/commands/ops-commands.cjs preserve contracts and shrink bin/oxe-cc.js', () => {
  it('exports createOpsCommandRegistry registering all 7 v1.22 commands and reduces bin/oxe-cc.js by >= 500 lines', () => {
    assert.equal(fs.existsSync(OPS_MODULE), true, 'bin/lib/commands/ops-commands.cjs must exist');
    const mod = require(OPS_MODULE);
    assert.equal(typeof mod.createOpsCommandRegistry, 'function');

    const registry = mod.createOpsCommandRegistry({
      colors: { red: '', yellow: '', green: '', dim: '', reset: '' },
      oxeOperational: {},
      oxeHealth: {},
      sessionDirId: () => null,
    });
    const requiredCommands = [
      'acceptance-audit',
      'release-readiness',
      'release-finalize',
      'preflight',
      'sync',
      'gc-worktrees',
      'worktree',
    ];
    for (const name of requiredCommands) {
      assert.equal(registry.has(name), true, `ops-commands registry must register "${name}"`);
    }

    const lineCount = fs.readFileSync(BIN, 'utf8').split(/\r?\n/).length;
    const saved = BASELINE_OXE_CC_LINES - lineCount;
    assert.ok(
      saved >= 500,
      `bin/oxe-cc.js must shrink by >= 500 lines vs ${BASELINE_OXE_CC_LINES} (current: ${lineCount}, saved: ${saved})`
    );
  });

  it('all 7 extracted commands preserve exact --help, --json contracts and error exit codes', () => {
    const cmds = [
      'acceptance-audit',
      'release-readiness',
      'release-finalize',
      'preflight',
      'sync',
      'gc-worktrees',
      'worktree',
    ];
    for (const cmd of cmds) {
      const helpRes = spawnSync(process.execPath, [BIN, cmd, '--help'], { encoding: 'utf8' });
      assert.equal(helpRes.status, 0, `${cmd} --help failed: ${helpRes.stderr}`);
      assert.ok(helpRes.stdout.trim().length > 20, `${cmd} --help must print help text`);

      const badFlag = spawnSync(process.execPath, [BIN, cmd, '--definitely-invalid-flag-xyz'], { encoding: 'utf8' });
      assert.equal(badFlag.status, 1, `${cmd} unknown flag must exit 1`);
    }

    const repo = mkGitRepo('oxe-a8-repo-');
    const acc = spawnSync(process.execPath, [BIN, 'acceptance-audit', '--dir', repo, '--json'], { encoding: 'utf8' });
    assert.equal(acc.status, 0, acc.stderr);
    assert.equal(JSON.parse(acc.stdout).oxeAcceptanceAuditSchema, 1);

    const pf = spawnSync(process.execPath, [BIN, 'preflight', '--dir', repo, '--json'], { encoding: 'utf8' });
    assert.equal(pf.status, 0, pf.stderr);
    assert.equal(JSON.parse(pf.stdout).oxePreflightSchema, 1);

    const gc = spawnSync(process.execPath, [BIN, 'gc-worktrees', '--dir', repo, '--json'], { encoding: 'utf8' });
    assert.equal(gc.status, 0, gc.stderr);
    assert.equal(JSON.parse(gc.stdout).oxeGcWorktreesSchema, 1);
  });
});
