'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const deferred = require('../bin/lib/oxe-deferred.cjs');

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
};

const writeRel = (dir, rel, content) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
};

const planOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));

function makeRepo({ tasks, files = {}, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c14-'));
  dirs.push(dir);
  writeRel(dir, '.gitignore', '.oxe/\n');
  writeRel(dir, '.oxe/STATE.md', '# STATE\n');
  writeRel(dir, '.oxe/PLAN.md', '# PLAN\n');
  writeRel(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | ok | pass |\n');
  writeRel(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  writeRel(dir, '.oxe/config.json', { external_dependency_check: false, plan_lint_preflight: false, stub_check: false, lint: { suite_impact: 'off' }, ...config });
  writeRel(dir, '.oxe/PLAN.json', { schema_version: 1, phase: 'F1', budget: { max_retries: 0 }, tasks });
  for (const [rel, txt] of Object.entries(files)) writeRel(dir, rel, txt);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@oxe.test');
  git(dir, 'config', 'user.name', 'OXE Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-C14: checkpoint_failed / plan reopen / deferred retry never trap tasks in completedWorkItems or external_pending', () => {
  it('1) checkpoint_failed (scope_insufficient) excludes the task from canonical_state.completedWorkItems and never classifies internal waits as external_pending', async () => {
    const RELATED_SCRIPT = [
      "const fs = require('fs');",
      "if (fs.readFileSync('src/header.js', 'utf8').includes('v2') && !fs.readFileSync('tests/legacy-header.test.js', 'utf8').includes('v2')) {",
      "  console.log(' FAIL  tests/legacy-header.test.js > header shows legacy badge');",
      '  process.exit(1);',
      '}',
      '',
    ].join('\n');

    const ok = `${process.execPath.replace(/\\/g, '/')} -e "process.exit(0)"`;
    const dir = makeRepo({
      tasks: [
        { id: 'T5', title: 'Redesign header', wave: 1, files: ['src/header.js'], acceptance: ['A1'], verify: { commands: [ok] } },
        { id: 'T6', title: 'Downstream header action', wave: 2, depends_on: ['T5'], files: ['src/header.js', 'src/actions.js'], acceptance: ['A1'], verify: { commands: [ok] } },
      ],
      files: {
        'src/header.js': 'module.exports = "v1";\n',
        'src/actions.js': 'module.exports = "a1";\n',
        'tests/legacy-header.test.js': 'module.exports = "v1";\n',
        'related.js': RELATED_SCRIPT,
        'related-run.js': RELATED_SCRIPT,
      },
      config: { checkpoint_related_tests: { command: 'node related.js {files}', run_command: 'node related-run.js {files}' } },
    });

    const res1 = await op.runRuntimeExecute(dir, null, {
      skipPreflight: true,
      checkpointCommits: true,
      executor: {
        async execute(node) {
          if (node.id === 'T5') writeRel(dir, 'src/header.js', 'module.exports = "v2";\n');
          return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
        },
      },
    });
    assert.equal(res1.result.status, 'checkpoint_failed');
    assert.equal(planOf(dir).tasks.find((t) => t.id === 'T5').done, false);
    assert.equal(planOf(dir).tasks.find((t) => t.id === 'T5').checkpoint_failed.kind, 'scope_insufficient');

    const rs1 = op.readRunState(dir, null);
    assert.equal(
      (rs1.canonical_state.completedWorkItems || []).includes('T5'),
      false,
      'T5 must NOT remain in canonical_state.completedWorkItems after checkpoint failure',
    );
    const workT5 = (rs1.canonical_state.workItems || []).find((w) => w.work_item_id === 'T5');
    if (workT5) assert.notEqual(workT5.status, 'completed');

    // Second execute while scope is still missing must keep T5 & T6 in `blocked`, NOT `external_pending` ("Aguardando entrega externa")
    let paidCalls = 0;
    const res2 = await op.runRuntimeExecute(dir, null, {
      skipPreflight: true,
      checkpointCommits: true,
      executor: {
        async execute() { paidCalls += 1; return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; },
      },
    });
    assert.equal(paidCalls, 0);
    assert.deepEqual(res2.result.external_pending, [], 'scope_insufficient/waiting_shared_files must NEVER become external_pending');
    assert.ok(res2.result.blocked.includes('T5'));
    assert.equal(res2.result.status, 'blocked');

    // Widening scope via CR + plan scope add clears scope_insufficient cleanly and next execute completes BOTH T5 and T6
    const fb = op.runtimeFeedback(dir, null, {
      class: 'spec_gap',
      criteria: 'A1',
      tasks: 'T5',
      summary: 'CR-47: include legacy-header.test.js in T5 scope',
      by: 'coordenacao',
    });
    op.runtimePlanScopeAdd(dir, null, {
      task: 'T5',
      paths: ['tests/legacy-header.test.js'],
      cr: fb.cr.id,
      by: 'coordenacao',
      reason: 'Include legacy header test broken by redesign',
    });

    const ran = [];
    const res3 = await op.runRuntimeExecute(dir, null, {
      skipPreflight: true,
      checkpointCommits: true,
      executor: {
        async execute(node) {
          ran.push(node.id);
          if (node.id === 'T5') writeRel(dir, 'tests/legacy-header.test.js', 'module.exports = "v2";\n');
          if (node.id === 'T6') writeRel(dir, 'src/actions.js', 'module.exports = "a2";\n');
          return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
        },
      },
    });
    assert.equal(res3.result.status, 'completed', JSON.stringify(res3.result));
    assert.deepEqual(ran, ['T5', 'T6']);
    assert.equal(planOf(dir).tasks.find((t) => t.id === 'T5').done, true);
    assert.equal(planOf(dir).tasks.find((t) => t.id === 'T6').done, true);
    const rs3 = op.readRunState(dir, null);
    assert.ok(rs3.canonical_state.completedWorkItems.includes('T5'));
    assert.ok(rs3.canonical_state.completedWorkItems.includes('T6'));
    assert.equal(rs3.canonical_state.blockedWorkItems.includes('T6'), false);
    assert.equal(rs3.canonical_state.run.status, 'completed');
  });

  it('2) plan reopen Tn cleans canonical_state.completedWorkItems and deferred.ndjson even when PLAN.json already has done=false (including CLI flags/case)', async () => {
    const ok = `${process.execPath.replace(/\\/g, '/')} -e "process.exit(0)"`;
    const dir = makeRepo({
      tasks: [
        { id: 'T5', title: 'Prompt card', wave: 1, files: ['src/prompt.js'], acceptance: ['A1'], verify: { commands: [ok] } },
      ],
      files: { 'src/prompt.js': 'module.exports = 1;\n' },
    });

    await op.runRuntimeExecute(dir, null, {
      skipPreflight: true,
      executor: {
        async execute() { return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; },
      },
    });
    assert.ok(op.readRunState(dir, null).canonical_state.completedWorkItems.includes('T5'));

    // Simulate chat-f5 state: PLAN.json has `done: false` and NO `checkpoint_failed`, yet run state STILL has T5 completed and AD-F1-1 is open!
    const pjPath = path.join(dir, '.oxe', 'PLAN.json');
    const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
    pj.tasks[0].done = false;
    delete pj.tasks[0].done_commit;
    fs.writeFileSync(pjPath, `${JSON.stringify(pj, null, 2)}\n`, 'utf8');
    const programDir = path.join(dir, '.oxe', 'program');
    deferred.add(programDir, { task: 'T5', phase: 'F1', reason: 'llm', evidence: 'residual', run_id: op.readRunState(dir, null).run_id });
    assert.equal(deferred.open(programDir).length, 1);

    // Run CLI `plan reopen t5 --dir <dir> --by coordenacao`
    const cli = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'oxe-cc.js'), 'plan', 'reopen', 't5', '--dir', dir, '--by', 'coordenacao'],
      { encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    assert.match(cli.stdout, /(?:✓|OK) T5 reaberta \(o próximo execute a refaz\)/);
    assert.doesNotMatch(cli.stdout, /não estava done/);

    const rsAfter = op.readRunState(dir, null);
    assert.equal(rsAfter.canonical_state.completedWorkItems.includes('T5'), false, 'completedWorkItems must be cleared');
    const workT5 = (rsAfter.canonical_state.workItems || []).find((w) => w.work_item_id === 'T5');
    if (workT5) assert.equal(workT5.status, 'pending');
    assert.equal(deferred.open(programDir).length, 0, 'open deferred entry must be closed as reopened');
    assert.equal(deferred.list(programDir)[0].status, 'reopened');
    assert.ok(op.readEvents(dir, null).some((e) => e.type === 'PlanTaskReopened' && e.work_item_id === 'T5'));

    // Idempotent second call cleanly reports "não estava done"
    const second = op.runtimePlanReopen(dir, null, { task: 'T5' });
    assert.equal(second.changed, false);

    // Unknown CLI option fails instead of corrupting dir resolution
    const badCli = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'oxe-cc.js'), 'plan', 'reopen', 'T5', '--dir', dir, '--bogus-flag'],
      { encoding: 'utf8' },
    );
    assert.equal(badCli.status, 1);
  });

  it('3) when runtime deferred retry returns ready, residual completedWorkItems/legacy external_dependency are cleaned and next runtime execute actually re-runs the task', async () => {
    const flagVerify = `${process.execPath.replace(/\\/g, '/')} -e "process.exit(require('fs').existsSync('src/ready.txt')?0:1)"`;
    const ok = `${process.execPath.replace(/\\/g, '/')} -e "process.exit(0)"`;
    const dir = makeRepo({
      tasks: [
        { id: 'T5', title: 'Deferred task', wave: 1, files: ['src/ready.txt'], acceptance: ['A1'], verify: { commands: [flagVerify] } },
        { id: 'T6', title: 'Dependent task', wave: 2, depends_on: ['T5'], files: ['src/next.txt'], acceptance: ['A1'], verify: { commands: [ok] } },
      ],
      files: { 'src/placeholder.txt': '1\n' },
    });

    // Initial execute fails T5's verify -> opens AD-F1-1 in deferred.ndjson and blocks T6
    const rFail = await op.runRuntimeExecute(dir, null, {
      skipPreflight: true,
      executor: { async execute() { return { success: true, failure_class: null, evidence: [], output: 'no file' }; } },
    });
    assert.equal(rFail.result.failed.includes('T5'), true);
    const programDir = path.join(dir, '.oxe', 'program');
    assert.deepEqual(deferred.open(programDir).map((d) => [d.id, d.task]), [['AD-F1-1', 'T5']]);

    // Simulate poisoned run state + legacy external_dependency classification on ACTIVE-RUN
    const poisoned = op.readRunState(dir, null);
    poisoned.canonical_state.completedWorkItems.push('T5');
    if (poisoned.compiled_graph && poisoned.compiled_graph.nodes) {
      const n5 = Array.isArray(poisoned.compiled_graph.nodes)
        ? poisoned.compiled_graph.nodes.find((n) => n.id === 'T5')
        : poisoned.compiled_graph.nodes.T5;
      if (n5) n5.policy.external_dependency = ['scope_insufficient: src/ready.txt'];
    }
    op.writeRunState(dir, null, poisoned);

    // Run `runtime deferred retry` -> still fails verify, so returns `ready`, updates deferred.ndjson with retry metadata, and cleans poisoned completedWorkItems
    const defOut = op.runtimeDeferred(dir, null, { action: 'retry' });
    assert.equal(defOut.retry[0].status, 'ready');
    const afterRetryEntry = deferred.list(programDir)[0];
    assert.equal(afterRetryEntry.status, 'open');
    assert.equal(afterRetryEntry.retry_count, 1);
    assert.equal(op.readRunState(dir, null).canonical_state.completedWorkItems.includes('T5'), false);

    // Next execute MUST re-run T5 (recompiling past stale external_dependency) and then run T6, closing AD-F1-1!
    const ran = [];
    const rPass = await op.runRuntimeExecute(dir, null, {
      skipPreflight: true,
      checkpointCommits: true,
      executor: {
        async execute(node) {
          ran.push(node.id);
          if (node.id === 'T5') writeRel(dir, 'src/ready.txt', 'ok\n');
          if (node.id === 'T6') writeRel(dir, 'src/next.txt', 'ok\n');
          return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
        },
      },
    });
    assert.equal(rPass.result.status, 'completed', JSON.stringify(rPass.result));
    assert.deepEqual(rPass.result.external_pending, []);
    assert.deepEqual(ran, ['T5', 'T6']);
    assert.equal(planOf(dir).tasks.find((t) => t.id === 'T5').done, true);
    assert.equal(planOf(dir).tasks.find((t) => t.id === 'T6').done, true);
    assert.equal(deferred.open(programDir).length, 0, 'AD-F1-1 closed on completion');
    assert.equal(deferred.list(programDir)[0].status, 'resolved');
  });
});
