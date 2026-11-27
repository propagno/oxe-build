'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const op = require('../../bin/lib/oxe-operational.cjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function mkDriftRepo(prefix = 'oxe-a5-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'contract.js'), 'exports.version = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'feature.js'), 'exports.ready = false;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'base commit');

  // Create program/feature branch with T1 already committed and T2 pending on src/contract.js
  git(dir, 'checkout', '-b', 'program');
  fs.writeFileSync(path.join(dir, 'src', 'feature.js'), 'exports.ready = true;\n');
  git(dir, 'add', 'src/feature.js');
  git(dir, 'commit', '-m', 'feat: T1 ready', '-m', 'OXE-Task: T1');

  // Advance main touching src/contract.js (creates contract_drift for pending T2!)
  git(dir, 'checkout', 'main');
  fs.writeFileSync(path.join(dir, 'src', 'contract.js'), 'exports.version = 2;\n');
  git(dir, 'add', 'src/contract.js');
  git(dir, 'commit', '-m', 'chore: upstream contract change on main');

  git(dir, 'checkout', 'program');

  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    tasks: [
      { id: 'T1', title: 'Feature ready', wave: 1, files: ['src/feature.js'], done: true },
      { id: 'T2', title: 'Update contract consumer', wave: 2, files: ['src/contract.js'], done: false },
    ],
    acceptance_tests: [],
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n\n### T1 — Feature ready\n- **Onda:** 1\n- **Arquivos alvo:** `src/feature.js`\n\n### T2 — Update contract consumer\n- **Onda:** 2\n- **Arquivos alvo:** `src/contract.js`\n');
  return dir;
}

describe('A5 — Reavaliação automática contra base no preflight de execute e em promote (OXB-230-05)', () => {
  it('OXB-230-05: buildRuntimeExecutePreflight and runtimePromote attach reevaluateAgainstBase drift warnings by default and block only when reevaluate.block_on_drift is true', () => {
    const dir = mkDriftRepo();
    try {
      // 1. Default mode (warn-only): runtimeExecute preflight attaches reevaluate + warning without blocking on reevaluate_drift
      assert.equal(typeof op.runRuntimeExecute, 'function', 'runtimeExecute must be exported');
      const preWarn = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
      assert.ok(preWarn.reevaluate && preWarn.reevaluate.ok === true, `expected preflight.reevaluate, got ${JSON.stringify(preWarn.reevaluate)}`);
      assert.equal(preWarn.reevaluate.summary.contract_drift, 1);
      assert.ok(preWarn.warnings.some((w) => /reevaluate|contract_drift/i.test(w)), `expected reevaluate warning, got ${JSON.stringify(preWarn.warnings)}`);
      assert.equal(preWarn.blockers.some((b) => /reevaluate_drift/i.test(b)), false, 'must NOT block when block_on_drift is not true');

      // 2. Default mode on runtimePromote (--dry-run): attaches reevaluate + warning, does not throw
      const promWarn = op.runtimePromote(dir, null, { task: 'T1', base: 'main', dryRun: true });
      assert.ok(promWarn.reevaluate && promWarn.reevaluate.ok === true, `expected promote.reevaluate, got ${JSON.stringify(promWarn.reevaluate)}`);
      assert.equal(promWarn.reevaluate.summary.contract_drift, 1);
      assert.ok(promWarn.warnings.some((w) => /reevaluate|contract_drift/i.test(w)), `expected promote reevaluate warning, got ${JSON.stringify(promWarn.warnings)}`);

      // 3. Strict mode (`reevaluate.block_on_drift: true`): both preflight and promote block on contract_drift
      fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ reevaluate: { block_on_drift: true } }, null, 2));
      const preBlock = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
      assert.equal(preBlock.ok, false);
      assert.ok(preBlock.blockers.some((b) => /reevaluate_drift/i.test(b)), `expected reevaluate_drift blocker, got ${JSON.stringify(preBlock.blockers)}`);

      assert.throws(
        () => op.runtimePromote(dir, null, { task: 'T1', base: 'main', dryRun: true }),
        /reevaluate|contract_drift/i,
        'runtimePromote must throw when reevaluate.block_on_drift is true and contract_drift > 0'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
