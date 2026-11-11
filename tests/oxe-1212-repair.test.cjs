'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const repair = require('../bin/lib/oxe-repair.cjs');

// 1.21.2 — OXB-130: a repair strategy after a failure — retry with a declared adjustment, decompose, or prune.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const gate = 'node -e "process.exit(1)"';

function project(task, extraTasks = [], repairCfg = { budget: 2 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rep-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A2\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, stub_check: false, execute: { defer_failed: true, repair: repairCfg } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, budget: { max_retries: 2 }, tasks: [task, ...extraTasks] }, null, 2));
  write(dir, 'src/a.js', '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const events = (dir) => fs.readFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('OXB-130: repair strategies', () => {
  it('a retry needs a concrete adjustment; without one it is refused', () => {
    const t = { id: 'T1', title: 'x', files: ['a.js'], acceptance: ['A1'] };
    const withAdj = repair.decide(t, { tasks: [t] }, { attempt: 1, failureClass: 'verify', output: 'Failing segment [1/1]: npm test\nnot ok 3 - soma negativa\nAssertionError: expected -1 to equal 1', config: { execute: { repair: {} } } });
    assert.equal(withAdj.strategy, 'retry');
    assert.match(withAdj.adjustment, /fazer passar: soma negativa/);
    const noAdj = repair.decide(t, { tasks: [t] }, { attempt: 1, failureClass: 'verify', output: 'exit 1', config: { execute: { repair: {} } } });
    assert.equal(noAdj.strategy, 'prune', 'single file and criterion: not decomposable');
    assert.equal(repair.decide(t, { tasks: [t] }, { attempt: 1, failureClass: 'env', output: 'x', config: {} }), null, 'environment is not repaired here');
  });

  it('decompose: a task with two criteria fails without adjustment → proposal T<n> (T1.1, T1.2) applied into the plan, dependents rewired', async () => {
    const dir = project({ id: 'T1', title: 'duas coisas', wave: 1, files: ['src/a.js'], acceptance: ['A1', 'A2'], verify: { commands: [gate] } }, [{ id: 'T2', title: 'depois', wave: 2, depends_on: ['T1'], files: ['src/b.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }]);
    let calls = 0;
    const executor = { async execute() { calls += 1; return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.equal(calls, 1, 'no blind retry');
    const ev = events(dir);
    const d = ev.find((e) => e.type === 'RepairDecided' && e.work_item_id === 'T1');
    assert.equal(d.payload.strategy, 'decompose');
    assert.ok(ev.some((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T1' && e.payload.reason === 'repair_decompose'));
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'repair', 'apply', 'T1', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /T1 (→|->) T3 \(T1\.1\), T4 \(T1\.2\)/);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(doc.tasks.map((t) => t.id), ['T3', 'T4', 'T2']);
    assert.deepEqual(doc.tasks[0].acceptance, ['A1']);
    assert.deepEqual(doc.tasks[1].acceptance, ['A2']);
    assert.equal(doc.tasks[0].split_of, 'T1');
    assert.deepEqual(doc.tasks[2].depends_on, ['T4']);
    assert.equal(doc.decomposed[0].id, 'T1');
    assert.deepEqual(require('../bin/lib/oxe-plan-json.cjs').validatePlanJson(doc), []);
  });

  it('prune: a non-decomposable task opens a CR for the owner with the task and the reason', async () => {
    const dir = project({ id: 'T1', title: 'inviável', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: [gate] } });
    const executor = { async execute() { return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    const ev = events(dir);
    const p = ev.find((e) => e.type === 'RepairProposed' && e.payload.strategy === 'prune');
    assert.match(String(p.payload.cr), /^CR-/);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8'), /T1 podada pelo reparo/);
  });

  it('the repair budget is per task: over it, no more retries', () => {
    const t = { id: 'T1', title: 'x', files: ['a.js'], acceptance: ['A1'] };
    const out = 'not ok 1 - caso\nAssertionError: x';
    assert.equal(repair.decide(t, { tasks: [t] }, { attempt: 1, failureClass: 'verify', output: out, repairsSoFar: 0, config: { execute: { repair: { budget: 1 } } } }).strategy, 'retry');
    assert.equal(repair.decide(t, { tasks: [t] }, { attempt: 2, failureClass: 'verify', output: out, repairsSoFar: 1, config: { execute: { repair: { budget: 1 } } } }).strategy, 'prune');
  });
});
