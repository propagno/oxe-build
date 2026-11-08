'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-071: frozen tests added after the run's first compile (CRs, plan edits) were "acceptance_not_frozen";
// OXB-072: an Electron suite passed the 60 s check timeout and was reported as FAIL.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const PASS = (name) => `node --test ${name}`;
const testFile = (title) => `const { test } = require('node:test');\ntest(${JSON.stringify(title)}, () => {});\n`;

function project({ plan, config = {}, files = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-vl-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A8 | a tinta | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, ...config }));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const writer = (dir) => ({
  async execute() {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'tint.js'), 'module.exports = 1;\n');
    return { success: true, failure_class: null, evidence: ['src/tint.js'], output: 'ok', completed_by: 'finish_task' };
  },
});
const checks = (dir) => op.readRunState(dir, null).verification_check_results || [];

describe('OXB-071: frozenness is judged against the plan, not the first compile snapshot', () => {
  it('tests added after the compile (same criterion without id, and a CR test with id) are frozen, not "não existia no compile"; editing them later is tampering', async () => {
    const plan = {
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'tinta', wave: 1, files: ['src/tint.js'], acceptance: ['A8'], verify: { commands: ['node -e "process.exit(0)"'] } }],
      acceptance_tests: [{ criterion: 'A8', files: ['test/a8.test.js'], command: PASS('test/a8.test.js') }],
    };
    const dir = project({ plan, files: { 'test/a8.test.js': testFile('a8') } });
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    // After the compile: a second A8 test (no id) and CR-15's test, as a CR / plan edit adds them.
    fs.writeFileSync(path.join(dir, 'test', 'a8-tint.test.js'), testFile('a8 tint'));
    fs.writeFileSync(path.join(dir, 'test', 'cr15.test.js'), testFile('cr15'));
    plan.acceptance_tests.push({ criterion: 'A8', files: ['test/a8-tint.test.js'], command: PASS('test/a8-tint.test.js'), version: 2 });
    plan.acceptance_tests.push({ id: 'cr15', criterion: 'A8', files: ['test/cr15.test.js'], command: PASS('test/cr15.test.js'), resolves: ['CR-15'] });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
    await op.runRuntimeVerify(dir, null, { gates: false });
    const errors = checks(dir).map((c) => `${c.check_id}:${c.error || ''}`).join('\n');
    assert.doesNotMatch(errors, /acceptance_not_frozen/);
    const lock = op.readRunState(dir, null).acceptance_lock;
    assert.ok(lock.tests.some((t) => t.late_frozen_at && t.files[0].path === 'test/cr15.test.js'), 'late tests recorded in the run lock');
    // A later edit of a late-frozen test is caught.
    fs.writeFileSync(path.join(dir, 'test', 'cr15.test.js'), testFile('cr15 weakened'));
    await op.runRuntimeVerify(dir, null, { gates: false });
    assert.match(checks(dir).map((c) => c.error || '').join('\n'), /acceptance_tampered: test\/cr15\.test\.js/);
  });
});

describe('OXB-072: a slow check is a timeout, not a FAIL, and its limit is configurable', () => {
  const sleeper = 'setTimeout(() => process.exit(0), 4000);\n';
  it('an acceptance test with timeout_ms that runs over it: status error, timed_out, with how to raise it', async () => {
    const plan = {
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/tint.js'], acceptance: ['A8'], verify: { commands: ['node -e "process.exit(0)"'] } }],
      acceptance_tests: [{ criterion: 'A8', files: ['test/slow.js'], command: 'node test/slow.js', timeout_ms: 1000 }],
    };
    const dir = project({ plan, files: { 'test/slow.js': sleeper } });
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    await op.runRuntimeVerify(dir, null, { gates: false });
    const slow = checks(dir).find((c) => c.check_id === 'check-accept-a8');
    assert.equal(slow.status, 'error');
    assert.equal(slow.timed_out, true);
    assert.match(slow.error, /^timeout: passou de 1s sem terminar — aumente verify_timeout_ms/);
  });

  it('config verify_timeout_ms is the default for every check (and a generous one lets it finish)', async () => {
    const plan = {
      schema_version: 1,
      tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/tint.js'], acceptance: ['A8'], verify: { commands: ['node -e "process.exit(0)"'] } }],
      acceptance_tests: [{ criterion: 'A8', files: ['test/slow.js'], command: 'node test/slow.js' }],
    };
    const tight = project({ plan, config: { verify_timeout_ms: 1000 }, files: { 'test/slow.js': sleeper } });
    await op.runRuntimeExecute(tight, null, { executor: writer(tight), skipPreflight: true });
    await op.runRuntimeVerify(tight, null, { gates: false });
    assert.equal(checks(tight).find((c) => c.check_id === 'check-accept-a8').timed_out, true);
    const roomy = project({ plan, files: { 'test/slow.js': sleeper } });
    await op.runRuntimeExecute(roomy, null, { executor: writer(roomy), skipPreflight: true });
    await op.runRuntimeVerify(roomy, null, { gates: false });
    const ok = checks(roomy).find((c) => c.check_id === 'check-accept-a8');
    assert.notEqual(ok.timed_out, true, 'the 10 min default covers a 4 s suite (the old 60 s default would too, but not Electron)');
  });
});
