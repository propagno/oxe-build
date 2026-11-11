'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 — OXB-085: T13 (remove AI Memory) had to wait for a workflow PR (#686) to merge. It could only be written in
// `notes`, and the TL held the launch by hand.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = `# SPEC

## Objetivo

x

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | a base funciona | manual |
`;

function project(tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pre-'));
  dirs.push(dir);
  const g = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  return { dir, g };
}

const writer = (dir, ran) => ({
  async execute(node) {
    ran.push(node.id);
    const file = node.id === 'T1' ? 'src/a.js' : 'src/memory-removed.js';
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'module.exports = 1;\n');
    return { success: true, failure_class: null, evidence: [file], output: 'ok', completed_by: 'finish_task' };
  },
});

describe('OXB-085: a task waits on a precondition outside the plan', () => {
  it('lint: precondition objects validate with a hint; strings keep meaning "delivered elsewhere"', () => {
    const bad = planJson.validatePlanJson
      ? planJson.validatePlanJson({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['a.js'], blocked_by: [{ kind: 'issue', ref: '#1' }, { kind: 'pr' }, { kind: 'pr', ref: '#686', until: 'later' }] }] })
      : null;
    const errors = bad ? (bad.errors || bad) : [planJson.preconditionProblem({ kind: 'issue', ref: '#1' }), planJson.preconditionProblem({ kind: 'pr' }), planJson.preconditionProblem({ kind: 'pr', ref: '#686', until: 'later' })];
    const text = [].concat(errors).join('\n');
    assert.match(text, /kind "issue" desconhecido — use pr, commit ou file/);
    assert.match(text, /pr: ref obrigatório \(ex\.: "#686"\)/);
    assert.match(text, /until "later" inválido — use merged \| closed/);
    const task = { blocked_by: ['propagno/oxespace#700', { kind: 'pr', ref: '#686' }, { kind: 'file', ref: 'docs/x.md' }] };
    assert.deepEqual(planJson.externalRefs(task), ['propagno/oxespace#700']);
    assert.deepEqual(planJson.taskPreconditions(task).map((p) => p.label), ['#686 (PR mergeado)', 'arquivo docs/x.md']);
  });

  it('execute holds only the waiting task ("aguardando"), it stays pending (not external), and runs once the precondition holds', async () => {
    const { dir, g } = project([
      { id: 'T1', title: 'base', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } },
      { id: 'T13', title: 'remover AI Memory', wave: 1, files: ['src/memory-removed.js'], blocked_by: [{ kind: 'file', ref: 'workflows/new-flow.yml' }], verify: { commands: ['node -e "process.exit(0)"'] } },
    ]);
    const ran = [];
    const first = await op.runRuntimeExecute(dir, null, { executor: writer(dir, ran), skipPreflight: true });
    assert.deepEqual(ran, ['T1'], 'T13 does not start while the precondition is unmet');
    assert.ok((first.result.external_pending || []).includes('T13'), JSON.stringify(first.result));
    const work = op.runtimePhaseWork(dir, null);
    assert.ok(work.pending.includes('T13') && !work.external_pending.includes('T13'), 'this plan\'s work, not an external delivery');
    assert.deepEqual(work.waiting, { T13: ['arquivo workflows/new-flow.yml'] });
    assert.equal(work.complete, false, 'the phase cannot close with T13 waiting');
    // The PR lands: the file exists.
    fs.mkdirSync(path.join(dir, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'workflows', 'new-flow.yml'), 'on: push\n');
    g('add', '-A');
    g('commit', '-qm', 'workflow');
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, ran), skipPreflight: true });
    assert.ok(ran.includes('T13'), ran.join(','));
  });

  it('commit on a branch and PR merged (gh) are checked; an unmet one becomes the node\'s "depende de" label', () => {
    const { dir, g } = project([]);
    const head = String(g('rev-parse', 'HEAD').stdout).trim();
    g('checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'f\n');
    g('add', '-A');
    g('commit', '-qm', 'feature');
    const featureSha = String(g('rev-parse', 'HEAD').stdout).trim();
    const calls = [];
    const gh = (cmd, args) => { calls.push(args.join(' ')); return { status: 0, stdout: args[2] === '686' ? 'MERGED\n' : 'OPEN\n' }; };
    const plan = { tasks: [
      { id: 'T1', meta: { waits_on: planJson.taskPreconditions({ blocked_by: [{ kind: 'commit', ref: head, branch: 'main' }, { kind: 'pr', ref: '#686' }] }) } },
      { id: 'T2', meta: { waits_on: planJson.taskPreconditions({ blocked_by: [{ kind: 'commit', ref: featureSha, branch: 'main' }, { kind: 'pr', ref: 'propagno/oxespace#687' }] }) } },
    ] };
    op.resolvePreconditions(dir, plan, { ghSpawn: gh });
    assert.equal(plan.tasks[0].meta.blocked_by, undefined, 'all met: not blocked');
    assert.equal(plan.tasks[0].meta.preconditions_met.length, 2);
    assert.deepEqual(plan.tasks[1].meta.blocked_by, [`commit ${featureSha.slice(0, 12)} em main`, 'propagno/oxespace#687 (PR mergeado)']);
    assert.ok(calls.some((c) => c === 'pr view 687 -R propagno/oxespace --json state -q .state'), calls.join('\n'));
    assert.ok(calls.some((c) => c === 'pr view 686 --json state -q .state'), 'a bare #n uses the current repo');
  });
});
