'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — TECH LEAD, F2 (rc.26):
// OXB-166: `runtime promote T4/T5/T6` cherry-picked F1's T4/T5/T6 (2026-11-04, `OXE-Task: T4`) — T-ids restart per phase.
// OXB-167: run oxe-run-mw83vtdy-8uzesq marked T4/T5 done with done_commit null; their changes stayed staged.
// OXB-165: the scheduler's 30-min run timeout, with no CLI/config wiring, aborted at the first wave past it.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const planOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));

function project({ plan, files = {}, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-cp-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, ...config }));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}
const writer = (dir, byTask, calls = []) => ({
  async execute(node) {
    calls.push(node.id);
    for (const [rel, content] of Object.entries(byTask[node.id] || {})) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return { success: true, failure_class: null, evidence: Object.keys(byTask[node.id] || {}), output: 'ok', completed_by: 'finish_task' };
  },
});
const ok = 'node -e "process.exit(0)"';
const hook = (dir, code) => {
  const p = path.join(dir, '.git', 'hooks', 'pre-commit');
  if (code == null) { fs.rmSync(p, { force: true }); return; }
  fs.writeFileSync(p, `#!/bin/sh\necho "lint-staged: 3 errors in src/a.js" >&2\nexit ${code}\n`);
  fs.chmodSync(p, 0o755);
};

describe('OXB-167: a task is done only with its checkpoint commit', () => {
  it('the commit fails (pre-commit hook): not done, checkpoint_failed, index clean, exit reported; the next execute retries the commit without the executor', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T4', title: 'preview automation', wave: 1, files: ['src/a.js', 'src/b.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/b.js': 'b0\n' } });
    hook(dir, 1);
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T4: { 'src/a.js': 'a1\n', 'src/b.js': 'b1\n' } }), skipPreflight: true, checkpointCommits: true });
    assert.equal(res.result.status, 'checkpoint_failed');
    assert.deepEqual(res.result.checkpoint_failed.map((f) => f.task), ['T4']);
    assert.match(res.result.checkpoint_failed[0].reason, /git commit falhou/);
    const t4 = planOf(dir).tasks[0];
    assert.equal(t4.done, false);
    assert.equal(t4.done_commit, undefined);
    assert.match(t4.checkpoint_failed.reason, /lint-staged/);
    assert.equal(git(dir, 'diff', '--cached', '--name-only').stdout.trim(), '', 'nothing left staged');
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.js'), 'utf8'), 'a1\n', 'the work stays in the tree');
    assert.ok(op.readEvents(dir, null).some((e) => e.type === 'CheckpointFailed' && e.work_item_id === 'T4'));
    // the hook is fixed: the next execute commits first and never calls the executor for T4
    hook(dir, null);
    const calls = [];
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, {}, calls), skipPreflight: true, checkpointCommits: true });
    assert.deepEqual(calls, [], 'no paid turn for finished work');
    const after1 = planOf(dir).tasks[0];
    assert.equal(after1.done, true);
    assert.equal(after1.checkpoint_failed, undefined);
    assert.equal(git(dir, 'rev-parse', 'HEAD').stdout.trim(), after1.done_commit);
    assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split(/\r?\n/).sort(), ['src/a.js', 'src/b.js']);
  });

  it('nothing changed in the scope: done with no commit, as before (not a failure)', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'noop', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n' } });
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, {}), skipPreflight: true, checkpointCommits: true });
    assert.equal(res.result.checkpoint_failed, undefined);
    assert.equal(planOf(dir).tasks[0].done, true);
  });
});

describe('OXB-166: the task trailer carries the phase', () => {
  it('checkpoint trailer `OXE-Task: F2/T4` + `OXE-Run`; findTaskCheckpoint ignores F1\'s phase-less T4', async () => {
    const plan = { schema_version: 1, phase: 'F2', tasks: [{ id: 'T4', title: 'x', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/old.js': 'o\n' } });
    // F1's T4, long before F2 started (old phase-less trailer)
    fs.writeFileSync(path.join(dir, 'src', 'old.js'), 'f1 t4\n');
    git(dir, 'add', '-A');
    spawnSync('git', ['commit', '-qm', 'feat: F1 T4 workspace colour\n\nOXE-Task: T4'], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-04T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-04T10:00:00Z' } });
    const f1t4 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    await op.runRuntimeExecute(dir, null, { executor: writer(dir, { T4: { 'src/a.js': 'a1\n' } }), skipPreflight: true, checkpointCommits: true });
    const body = git(dir, 'log', '-1', '--format=%B').stdout;
    assert.match(body, /^OXE-Task: F2\/T4$/m);
    assert.match(body, /^OXE-Run: oxe-run-/m);
    const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(op.findTaskCheckpoint(dir, 'T4', { phase: 'F2', since: '2026-11-07T00:00:00Z' }), head);
    assert.deepEqual(op.taskCommitShas(dir, 'T4', null, { phase: 'F2', since: '2026-11-07T00:00:00Z' }), [head], 'F1\'s T4 is not F2\'s');
    // with no phase in play (single-plan projects), the phase-less trailer still counts
    assert.ok(op.taskCommitShas(dir, 'T4', null, {}).includes(f1t4));
    // a phase-less trailer committed during the phase (rc ≤ 26 runs of F2) counts
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'feat: F2 T4 fix (rc.26)\n\nOXE-Task: T4');
    const rc26 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.ok(op.taskCommitShas(dir, 'T4', null, { phase: 'F2', since: '2026-11-07T00:00:00Z' }).includes(rc26));
  });

  it('promote of F2\'s T4 with a done_commit takes only F2\'s commits, never F1\'s T4', () => {
    const plan = { schema_version: 1, phase: 'F2', tasks: [{ id: 'T4', title: 'x', wave: 1, files: ['src/a.js'], done: true }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/old.js': 'o\n' } });
    git(dir, 'checkout', '-qb', 'program');
    fs.writeFileSync(path.join(dir, 'src', 'old.js'), 'f1 t4\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'feat: F1 T4\n\nOXE-Task: T4');
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a1\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'feat: F2 T4\n\nOXE-Task: F2/T4');
    const f2 = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const p = planOf(dir); p.tasks[0].done_commit = f2;
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(p));
    const out = op.runtimePromote(dir, null, { task: 'T4', base: 'main', prReady: false });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.commits, [f2]);
  });
});

describe('OXB-165: run-level timeout', () => {
  it('no 30-min default; executor.max_run_ms (or --max-run-ms) sets one', async () => {
    const plan = { schema_version: 1, tasks: [
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], verify: { commands: ['node -e "setTimeout(()=>{},300)"'] } },
      { id: 'T2', title: 'b', wave: 2, depends_on: ['T1'], files: ['src/b.js'], verify: { commands: [ok] } },
    ] };
    const dir = project({ plan, files: { 'src/a.js': '0\n', 'src/b.js': '0\n' }, config: { executor: { max_run_ms: 50 } } });
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, {}), skipPreflight: true });
    assert.ok(!(res.result.completed || []).includes('T2'), 'wave 2 aborted by the configured limit');
    const dir2 = project({ plan, files: { 'src/a.js': '0\n', 'src/b.js': '0\n' } });
    const res2 = await op.runRuntimeExecute(dir2, null, { executor: writer(dir2, {}), skipPreflight: true });
    assert.deepEqual(res2.result.completed.sort(), ['T1', 'T2']);
  });
});

describe('OXB-168: the checkpoint commits what changed, not the scope as pathspecs', () => {
  it('a scope path an earlier task already deleted (and committed) does not reject the commit; deletions and new files go in', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T4', title: 'remove preview', wave: 1, files: ['src/a.js', 'src/b.js', 'src/c.js', 'src/new.ts', 'services/documentation/runtime.ts', 'electron/main/mcp-internal/documentation-handler.ts'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n', 'src/b.js': 'b0\n', 'src/c.js': 'c0\n', 'services/documentation/runtime.ts': 'r\n', 'electron/main/mcp-internal/documentation-handler.ts': 'h\n' } });
    // T7 (R9) removed services/documentation and the handler first, committed
    git(dir, 'rm', '-q', '-r', 'services/documentation', 'electron/main/mcp-internal/documentation-handler.ts');
    git(dir, 'commit', '-qm', 'feat: T7 remove documentation\n\nOXE-Task: T7');
    const executor = {
      async execute() {
        fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a1\n');
        fs.writeFileSync(path.join(dir, 'src', 'new.ts'), 'export {};\n');
        fs.rmSync(path.join(dir, 'src', 'b.js'));
        git(dir, 'rm', '-q', 'src/c.js'); // a deletion already staged
        return { success: true, failure_class: null, evidence: ['src/a.js'], output: 'ok', completed_by: 'finish_task' };
      },
    };
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, checkpointCommits: true });
    assert.equal(res.result.checkpoint_failed, undefined, JSON.stringify(res.result.checkpoint_failed));
    const t4 = planOf(dir).tasks[0];
    assert.equal(t4.done, true);
    assert.equal(t4.done_commit, git(dir, 'rev-parse', 'HEAD').stdout.trim());
    const st = git(dir, 'show', '--name-status', '--format=', 'HEAD').stdout.trim().split(/\r?\n/).map((l) => l.replace(/\t/, ' ')).sort();
    assert.deepEqual(st, ['A src/new.ts', 'D src/b.js', 'D src/c.js', 'M src/a.js']);
    assert.equal(git(dir, 'status', '--porcelain').stdout.trim(), '', 'nothing left behind');
  });

  it('commitTaskCheckpoint reports scope_absent instead of failing', () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T5', title: 'x', wave: 1, files: ['src/a.js', 'gone/x.ts'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n' } });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a1\n');
    const cp = op.commitTaskCheckpoint(dir, { run_id: 'r1', compiled_graph: { nodes: {} } }, 'T5', { task: plan.tasks[0] });
    assert.equal(cp.committed, true, cp.reason);
    assert.deepEqual(cp.scope_absent, ['gone/x.ts']);
  });
});
