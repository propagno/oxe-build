'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const reeval = require('../../bin/lib/oxe-reevaluate.cjs');
const oxeOp = require('../../bin/lib/oxe-operational.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkGitRepo(prefix = 'oxe-a18-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'exports.a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'exports.b = 1;\n');
  fs.writeFileSync(path.join(dir, 'migrations', '001_init.sql'), 'CREATE TABLE t(id INT);\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A18 — Reavaliação contínua de solução (oxe-cc reevaluate) (OXB-222-18)', () => {
  it('OXB-222-18: reevaluateAgainstBase classifies pending tasks into no_impact, mechanical_sync, and contract_drift', () => {
    const dir = mkGitRepo('oxe-a18-eval-');
    try {
      const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      // Create feature branch at baseCommit
      execFileSync('git', ['checkout', '-b', 'feat/wip'], { cwd: dir, stdio: 'ignore' });
      // Advance main with two upstream changes: a new migration (002) and an edit to src/a.js
      execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'exports.a = 2; exports.breaking = true;\n');
      fs.writeFileSync(path.join(dir, 'migrations', '002_upstream.sql'), 'ALTER TABLE t ADD c INT;\n');
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'feat: upstream contract + migration'], { cwd: dir, stdio: 'ignore' });

      // Back to feature branch with PLAN.json having 3 pending tasks
      execFileSync('git', ['checkout', 'feat/wip'], { cwd: dir, stdio: 'ignore' });
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
        schema_version: 1,
        tasks: [
          { id: 'T1', title: 'Disjoint work', files: ['src/b.js'], acceptance: ['A1'], done: false },
          { id: 'T2', title: 'Add migration 002', files: ['migrations/002_mine.sql'], acceptance: ['A2'], done: false },
          { id: 'T3', title: 'Modify src/a contract', files: ['src/a.js'], acceptance: ['A3'], done: false },
        ],
        acceptance_tests: [],
      }, null, 2));

      const res = reeval.reevaluateAgainstBase(dir, { against: 'main', since: baseCommit });
      assert.equal(res.ok, true);
      assert.equal(res.upstream_commits_count, 1);
      assert.equal(res.overall_status, 'replan_recommended');
      assert.equal(res.summary.no_impact, 1);
      assert.equal(res.summary.mechanical_sync, 1);
      assert.equal(res.summary.contract_drift, 1);

      const t1 = res.tasks.find((t) => t.id === 'T1');
      const t2 = res.tasks.find((t) => t.id === 'T2');
      const t3 = res.tasks.find((t) => t.id === 'T3');
      assert.equal(t1.classification, 'no_impact');
      assert.equal(t2.classification, 'mechanical_sync');
      assert.match(t2.recommended_action, /oxe-cc sync/i);
      assert.equal(t3.classification, 'contract_drift');
      assert.ok(t3.overlapping_files.includes('src/a.js'));
      assert.match(t3.recommended_action, /feedback|cr/i);

      // CLI oxe-cc reevaluate --against main --since <sha> --json + SDK export
      assert.equal(typeof oxeOp.runtimeReevaluate, 'function');
      const cliOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'reevaluate', '--against', 'main', '--since', baseCommit, '--dir', dir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(cliOut.oxeReevaluateSchema, 1);
      assert.equal(cliOut.overall_status, 'replan_recommended');
      assert.equal(cliOut.summary.contract_drift, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
