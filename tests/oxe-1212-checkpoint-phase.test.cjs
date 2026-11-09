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

  it('nothing changed and no earlier checkpoint: empty_checkpoint, not done (OXB-176; was done with no commit)', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'noop', wave: 1, files: ['src/a.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/a.js': 'a0\n' } });
    const res = await op.runRuntimeExecute(dir, null, { executor: writer(dir, {}), skipPreflight: true, checkpointCommits: true });
    assert.equal(res.result.checkpoint_failed[0].kind, 'empty_checkpoint');
    assert.notEqual(planOf(dir).tasks[0].done, true);
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

describe('OXB-170: a checkpoint holds only its own task\'s hunks', () => {
  // shared.txt: A (T1) changes line 1, B (T2, interrupted) changed line 9 — far apart, same file.
  const SHARED = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const withLine = (text, n, v) => text.split('\n').map((l, i) => (i === n ? v : l)).join('\n');

  it('retry after an interrupted B: A\'s commit has none of B\'s hunks; B runs again and still sees its partial edits, and its commit carries them', async () => {
    const plan = { schema_version: 1, tasks: [
      { id: 'T1', title: 'A', wave: 1, files: ['shared.txt', 'a.txt'], verify: { commands: [ok] } },
      { id: 'T2', title: 'B', wave: 2, depends_on: ['T1'], files: ['shared.txt', 'b.txt'], verify: { commands: [ok] } },
    ] };
    const dir = project({ plan, files: { 'shared.txt': SHARED, 'a.txt': 'a0\n', 'b.txt': 'b0\n' } });
    // run 1: A passes its verify but its checkpoint fails (hook); wave 1 only
    hook(dir, 1);
    const execA = { async execute(node) {
      if (node.id === 'T1') { fs.writeFileSync(path.join(dir, 'shared.txt'), withLine(SHARED, 1, 'line 1 by A')); fs.writeFileSync(path.join(dir, 'a.txt'), 'a1\n'); }
      return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
    } };
    await op.runRuntimeExecute(dir, null, { executor: execA, skipPreflight: true, checkpointCommits: true, wave: 1 });
    assert.ok(planOf(dir).tasks[0].checkpoint_failed.snapshot, 'the task\'s own content is saved with the failure');
    // B starts and is killed mid-way: its partial edits on shared.txt (line 9) and b.txt stay in the tree
    const run = op.readRunState(dir, null).run_id;
    fs.writeFileSync(path.join(dir, 'shared.txt'), withLine(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8'), 9, 'line 9 by B (partial)'));
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b-partial\n');
    fs.appendFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), JSON.stringify({ type: 'AttemptStarted', run_id: run, work_item_id: 'T2', timestamp: new Date().toISOString(), payload: { attempt_number: 1 } }) + '\n');
    hook(dir, null);
    // run 2 (relaunch): A's checkpoint is retried first; then B runs
    let bSaw = null;
    const execB = { async execute(node) {
      if (node.id === 'T2') {
        bSaw = fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8');
        fs.writeFileSync(path.join(dir, 'b.txt'), 'b1\n');
      }
      return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
    } };
    await op.runRuntimeExecute(dir, null, { executor: execB, skipPreflight: true, checkpointCommits: true });
    const p = planOf(dir);
    const a = p.tasks.find((t) => t.id === 'T1');
    assert.equal(a.done, true, JSON.stringify(a.checkpoint_failed));
    const aShared = git(dir, 'show', `${a.done_commit}:shared.txt`).stdout;
    assert.match(aShared, /line 1 by A/);
    assert.doesNotMatch(aShared, /by B/, 'none of B\'s hunks in A\'s commit');
    assert.deepEqual(git(dir, 'show', '--name-only', '--format=', a.done_commit).stdout.trim().split(/\r?\n/).sort(), ['a.txt', 'shared.txt']);
    assert.match(bSaw, /line 9 by B \(partial\)/, 'B\'s retry sees its partial edits');
    const b = p.tasks.find((t) => t.id === 'T2');
    assert.equal(b.done, true, JSON.stringify(b.checkpoint_failed));
    assert.match(git(dir, 'show', `${b.done_commit}:shared.txt`).stdout, /line 9 by B \(partial\)/, 'B\'s commit carries its own earlier edits');
    assert.ok(op.readEvents(dir, null).some((e) => e.type === 'InterruptedWorkFound' && e.payload.tasks[0].task === 'T2'));
    assert.equal(git(dir, 'status', '--porcelain').stdout.trim(), '');
  });

  it('live checkpoint: a file already dirty with another task\'s edits gets only this task\'s diff', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'A', wave: 1, files: ['shared.txt'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'shared.txt': SHARED } });
    fs.writeFileSync(path.join(dir, 'shared.txt'), withLine(SHARED, 9, 'line 9 by someone else'));
    const exec = { async execute() {
      fs.writeFileSync(path.join(dir, 'shared.txt'), withLine(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8'), 1, 'line 1 by A'));
      return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
    } };
    await op.runRuntimeExecute(dir, null, { executor: exec, skipPreflight: true, checkpointCommits: true });
    const head = git(dir, 'show', 'HEAD:shared.txt').stdout;
    assert.match(head, /line 1 by A/);
    assert.doesNotMatch(head, /someone else/);
    assert.match(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8'), /line 9 by someone else/, 'the other edit stays in the tree, unstaged');
    assert.equal(git(dir, 'diff', '--cached', '--name-only').stdout.trim(), '');
  });

  it('checkpoint_check runs on the commit\'s own tree; red undoes the commit and the task is not done', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'A', wave: 1, files: ['a.txt'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'a.txt': 'a0\n' }, config: { checkpoint_check: 'node -e "process.exit(require(\'fs\').readFileSync(\'a.txt\',\'utf8\').includes(\'bad\')?1:0)"' } });
    const before = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const exec = { async execute() { fs.writeFileSync(path.join(dir, 'a.txt'), 'bad\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    const res = await op.runRuntimeExecute(dir, null, { executor: exec, skipPreflight: true, checkpointCommits: true });
    assert.match(res.result.checkpoint_failed[0].reason, /checkpoint_check vermelho/);
    assert.equal(git(dir, 'rev-parse', 'HEAD').stdout.trim(), before, 'commit undone');
    assert.equal(planOf(dir).tasks[0].done, false);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'bad\n', 'work kept in the tree');
    assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'checkpoint-ws')) || fs.readdirSync(path.join(dir, '.oxe', 'checkpoint-ws')).length === 0);
  });
});

describe('OXB-172: the checkpoint runs the tests related to the task\'s own changed files', () => {
  // fake "vitest related": tests/integration/remote.test.js imports src/proto.js and fails on v2
  const RELATED = [
    "const fs = require('fs');",
    "const files = process.argv.slice(2);",
    "if (files.join(' ') !== 'src/proto.js') { console.log('unexpected files: ' + files.join(' ')); process.exit(3); }", // only the task's own changed files
    "if (files.includes('src/proto.js') && fs.readFileSync('src/proto.js', 'utf8').includes('v2')) {",
    "  console.log(' FAIL  tests/integration/remote.test.js > remote gateway handshake');",
    "  console.log(' ❯ tests/integration/remote.test.js (2 tests | 2 failed)');",
    "  process.exit(1);",
    "}",
    '',
  ].join('\n');
  const cfg = { checkpoint_related_tests: { command: 'node related.js {files}', run_command: 'node related-run.js {files}' } };
  const exec = (dir) => ({ async execute() { fs.writeFileSync(path.join(dir, 'src', 'proto.js'), 'module.exports = "v2";\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } });

  it('a test outside the task\'s verify and scope goes red → checkpoint_failed scope_insufficient naming it, not done, and the task waits', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'protocol v2', wave: 1, files: ['src/proto.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/proto.js': 'module.exports = "v1";\n', 'tests/integration/remote.test.js': "require('../../src/proto.js');\n", 'related.js': RELATED }, config: cfg });
    const before = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const res = await op.runRuntimeExecute(dir, null, { executor: exec(dir), skipPreflight: true, checkpointCommits: true });
    assert.equal(git(dir, 'rev-parse', 'HEAD').stdout.trim(), before, 'commit undone');
    const t1 = planOf(dir).tasks[0];
    assert.equal(t1.done, false);
    assert.equal(t1.checkpoint_failed.kind, 'scope_insufficient');
    assert.deepEqual(t1.checkpoint_failed.related_red, ['tests/integration/remote.test.js']);
    assert.match(t1.checkpoint_failed.reason, /remote gateway handshake/);
    assert.match(res.result.checkpoint_failed[0].reason, /scope_insufficient: .*tests\/integration\/remote\.test\.js/);
    assert.ok(op.readEvents(dir, null).some((e) => e.type === 'ScopeInsufficient' && e.payload.at === 'checkpoint'));
    // next execute: the task waits (no blind re-run)
    let calls = 0;
    await op.runRuntimeExecute(dir, null, { executor: { async execute() { calls += 1; return { success: true, failure_class: null, evidence: [], output: 'ok' }; } }, skipPreflight: true, checkpointCommits: true });
    assert.equal(calls, 0, 'scope_insufficient waits for a plan edit / CR');
    // plan reopen clears it
    assert.equal(op.runtimePlanReopen(dir, null, { task: 'T1' }).changed, true);
    assert.equal(planOf(dir).tasks[0].checkpoint_failed, undefined);
  });

  it('the red test inside the task\'s scope → related_tests; the next execute runs it in the task\'s verify', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'protocol v2', wave: 1, files: ['src/proto.js', 'tests/integration/remote.test.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/proto.js': 'module.exports = "v1";\n', 'tests/integration/remote.test.js': "require('../../src/proto.js');\n", 'related.js': RELATED }, config: cfg });
    await op.runRuntimeExecute(dir, null, { executor: exec(dir), skipPreflight: true, checkpointCommits: true });
    const t1 = planOf(dir).tasks[0];
    assert.equal(t1.done, false);
    assert.equal(t1.checkpoint_failed.kind, 'related_tests');
    const compiled = op.compileExecutionGraphFromArtifacts(dir, null, {}).run.compiled_graph;
    const nodes = Array.isArray(compiled.nodes) ? compiled.nodes : Object.values(compiled.nodes);
    assert.match(nodes.find((n) => n.id === 'T1').verify.command, /node related-run\.js tests\/integration\/remote\.test\.js/);
  });

  it('off by default: no related run, the task is done as before', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'protocol v2', wave: 1, files: ['src/proto.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, files: { 'src/proto.js': 'module.exports = "v1";\n', 'related.js': RELATED } });
    await op.runRuntimeExecute(dir, null, { executor: exec(dir), skipPreflight: true, checkpointCommits: true });
    assert.equal(planOf(dir).tasks[0].done, true);
  });
});

describe('OXB-173: task ids are positional — interrupted work follows the task, not the id', () => {
  const SHARED = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const withLine = (text, n, v) => text.split('\n').map((l, i) => (i === n ? v : l)).join('\n');

  it('a task inserted before an interrupted one: the leftovers stay with the original task (now T3), never with the new T2', async () => {
    const plan1 = { schema_version: 1, tasks: [
      { id: 'T1', title: 'A', wave: 1, files: ['a.txt'], verify: { commands: [ok] } },
      { id: 'T2', title: 'R4 remove rtk', wave: 2, depends_on: ['T1'], files: ['shared.txt', 'r4.txt'], verify: { commands: [ok] } },
    ] };
    const dir = project({ plan: plan1, files: { 'shared.txt': SHARED, 'a.txt': 'a0\n', 'r4.txt': 'r0\n', 'cr36.txt': 'c0\n' } });
    const execA = { async execute(node) { if (node.id === 'T1') fs.writeFileSync(path.join(dir, 'a.txt'), 'a1\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor: execA, skipPreflight: true, checkpointCommits: true, wave: 1 });
    // R4 (T2) starts and is killed: partial edits in the tree
    const run = op.readRunState(dir, null).run_id;
    fs.writeFileSync(path.join(dir, 'shared.txt'), withLine(SHARED, 9, 'line 9 by R4 (partial)'));
    fs.writeFileSync(path.join(dir, 'r4.txt'), 'r-partial\n');
    fs.appendFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), JSON.stringify({ type: 'AttemptStarted', run_id: run, work_item_id: 'T2', timestamp: new Date().toISOString(), payload: { attempt_number: 1 } }) + '\n');
    // CR36 is inserted mid-chain: it becomes T2, R4 becomes T3 (and CR36 also touches shared.txt)
    const p = planOf(dir);
    p.tasks = [p.tasks[0],
      { id: 'T2', title: 'CR36 menu fix', wave: 2, depends_on: ['T1'], files: ['shared.txt', 'cr36.txt'], verify: { commands: [ok] } },
      { id: 'T3', title: 'R4 remove rtk', wave: 3, depends_on: ['T2'], files: ['shared.txt', 'r4.txt'], verify: { commands: [ok] } }];
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(p, null, 2));
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(lint.warnings.some((w) => /T2: o título mudou desde a run .*"R4 remove rtk" → "CR36 menu fix"/.test(w)), lint.warnings.join('\n'));
    let r4Saw = null;
    const exec2 = { async execute(node) {
      if (node.id === 'T2') { fs.writeFileSync(path.join(dir, 'cr36.txt'), 'c1\n'); fs.writeFileSync(path.join(dir, 'shared.txt'), withLine(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8'), 1, 'line 1 by CR36')); }
      if (node.id === 'T3') { r4Saw = fs.readFileSync(path.join(dir, 'r4.txt'), 'utf8'); fs.writeFileSync(path.join(dir, 'r4.txt'), 'r1\n'); }
      return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
    } };
    await op.runRuntimeExecute(dir, null, { executor: exec2, skipPreflight: true, checkpointCommits: true });
    const found = op.readEvents(dir, null).find((e) => e.type === 'InterruptedWorkFound');
    assert.equal(found.payload.tasks[0].task, 'T3');
    assert.deepEqual(found.payload.tasks[0].renumbered, { from: 'T2', title: 'R4 remove rtk', to: 'T3' });
    const tasks = planOf(dir).tasks;
    const t2 = tasks.find((t) => t.id === 'T2');
    const t3 = tasks.find((t) => t.id === 'T3');
    assert.equal(t2.done, true);
    const t2Shared = git(dir, 'show', `${t2.done_commit}:shared.txt`).stdout;
    assert.match(t2Shared, /line 1 by CR36/);
    assert.doesNotMatch(t2Shared, /by R4/, 'the new T2 (CR36) never gets R4\'s leftovers');
    assert.equal(r4Saw, 'r-partial\n', 'R4 (now T3) still sees its partial edits');
    assert.equal(t3.done, true);
    assert.match(git(dir, 'show', `${t3.done_commit}:shared.txt`).stdout, /line 9 by R4 \(partial\)/, 'R4\'s commit carries its own leftovers');
  });
});

describe('OXB-174: a task\'s own leftovers from its earlier failed attempts go into its commit', () => {
  const gate = 'node -e "process.exit(require(\'fs\').existsSync(\'.oxe/go\')?0:1)"';
  it('A fails with in-scope edits; the next run completes A without touching them again → A\'s commit contains them', async () => {
    const plan = { schema_version: 1, budget: { max_retries: 0 }, tasks: [{ id: 'T3', title: 'BE-A67-c5', wave: 1, files: ['src/desktop.ts', 'src/filters.ts', 'tests/topics.test.js'], verify: { commands: [gate] } }] };
    const dir = project({ plan, files: { 'src/desktop.ts': 'd0\n', 'src/filters.ts': 'f0\n', 'tests/topics.test.js': 't0\n' }, config: { isolate_failed_attempts: false } });
    const failing = { async execute() { fs.writeFileSync(path.join(dir, 'src', 'desktop.ts'), 'd1\n'); fs.writeFileSync(path.join(dir, 'src', 'filters.ts'), 'f1\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor: failing, skipPreflight: true, checkpointCommits: true });
    assert.notEqual(planOf(dir).tasks[0].done, true);
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'desktop.ts'), 'utf8'), 'd1\n', 'the failed attempt left its edits');
    fs.writeFileSync(path.join(dir, '.oxe', 'go'), '');
    const second = { async execute() { fs.writeFileSync(path.join(dir, 'tests', 'topics.test.js'), 't1\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor: second, skipPreflight: true, checkpointCommits: true });
    const t3 = planOf(dir).tasks[0];
    assert.equal(t3.done, true, JSON.stringify(t3.checkpoint_failed));
    assert.deepEqual(git(dir, 'show', '--name-only', '--format=', t3.done_commit).stdout.trim().split(/\r?\n/).sort(), ['src/desktop.ts', 'src/filters.ts', 'tests/topics.test.js']);
    assert.equal(git(dir, 'status', '--porcelain').stdout.trim(), '');
  });

  it('another task\'s interrupted leftovers in a shared file are still refused', async () => {
    const plan = { schema_version: 1, budget: { max_retries: 0 }, tasks: [
      { id: 'T1', title: 'A', wave: 1, files: ['src/a.ts', 'src/shared.ts'], verify: { commands: [gate] } },
      { id: 'T2', title: 'B', wave: 2, files: ['src/shared.ts', 'src/b.ts'], verify: { commands: [ok] } },
    ] };
    const dir = project({ plan, files: { 'src/a.ts': 'a0\n', 'src/shared.ts': 's0\n', 'src/b.ts': 'b0\n' }, config: { isolate_failed_attempts: false } });
    const failing = { async execute(node) { if (node.id === 'T1') fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'a1\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor: failing, skipPreflight: true, checkpointCommits: true, wave: 1 });
    // B starts and is killed with an edit on the shared file
    const run = op.readRunState(dir, null).run_id;
    fs.writeFileSync(path.join(dir, 'src', 'shared.ts'), 's-by-B\n');
    fs.appendFileSync(path.join(dir, '.oxe', 'OXE-EVENTS.ndjson'), JSON.stringify({ type: 'AttemptStarted', run_id: run, work_item_id: 'T2', timestamp: new Date().toISOString(), payload: { attempt_number: 1 } }) + '\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'go'), '');
    const second = { async execute() { return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor: second, skipPreflight: true, checkpointCommits: true, wave: 1 });
    const t1 = planOf(dir).tasks.find((t) => t.id === 'T1');
    assert.equal(t1.done, true, JSON.stringify(t1.checkpoint_failed));
    const files = git(dir, 'show', '--name-only', '--format=', t1.done_commit).stdout.trim().split(/\r?\n/);
    assert.deepEqual(files, ['src/a.ts'], 'A takes its own a.ts, never B\'s shared.ts');
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'shared.ts'), 'utf8'), 's-by-B\n');
  });
});

describe('OXB-175: related reds that are not the task\'s never undo its commit; a checkpoint failure stops the chain', () => {
  // fake related: prints FAIL for every file listed in RED (env), exit 1 if any
  const RELATED = "const red=String(process.env.OXE_TEST_RED||'').split(',').filter(Boolean);for(const f of red)console.log(' FAIL  '+f+' > by design');process.exit(red.length?1:0);\n";
  // fake run on the parent: red for files in OXE_TEST_RED_BEFORE
  const RUN = "const red=String(process.env.OXE_TEST_RED_BEFORE||'').split(',').filter(Boolean);const args=process.argv.slice(2);let bad=0;for(const f of args)if(red.includes(f)){console.log(' FAIL  '+f+' > before');bad++;}process.exit(bad?1:0);\n";
  const cfg = { checkpoint_related_tests: { command: 'node related.js {files}', run_command: 'node related-run.js {files}' } };
  const withEnv = async (env, fn) => { const prev = { ...process.env }; Object.assign(process.env, env); try { return await fn(); } finally { for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } } };
  const exec = (dir, calls = []) => ({ async execute(node) { calls.push(node.id); fs.writeFileSync(path.join(dir, 'src', `${node.id.toLowerCase()}.js`), 'changed\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } });
  const base = (extraTests = []) => ({ schema_version: 1, tasks: [
    { id: 'T1', title: 'CR37', wave: 1, files: ['src/t1.js'], acceptance: ['A1'], verify: { commands: [ok] } },
    { id: 'T2', title: 'later', wave: 2, depends_on: ['T1'], files: ['src/t2.js'], acceptance: ['A2'], verify: { commands: [ok] } },
  ], acceptance_tests: [{ criterion: 'A2', task: 'T2', files: ['tests/acceptance/f2/g3-no-removed-terms.test.js'], command: 'x' }, ...extraTests] });
  const files = { 'src/t1.js': 'v1\n', 'src/t2.js': 'v1\n', 'related.js': RELATED, 'related-run.js': RUN };

  it('frozen tests of a pending task, parked folders and other phases are not the task\'s red → committed', async () => {
    const dir = project({ plan: base(), files, config: cfg });
    await withEnv({ OXE_TEST_RED: 'tests/acceptance/f2/g3-no-removed-terms.test.js,tests/acceptance/parked-f3/a10.test.js,tests/acceptance/bugs/claude-plan-label-live.test.js' }, () =>
      op.runRuntimeExecute(dir, null, { executor: exec(dir), skipPreflight: true, checkpointCommits: true, wave: 1 }));
    const t1 = planOf(dir).tasks[0];
    assert.equal(t1.done, true, JSON.stringify(t1.checkpoint_failed));
    assert.ok(t1.done_commit);
  });

  it('a test red on the parent commit too is not the task\'s red → committed', async () => {
    const dir = project({ plan: base(), files, config: cfg });
    await withEnv({ OXE_TEST_RED: 'tests/integration/legacy.test.js', OXE_TEST_RED_BEFORE: 'tests/integration/legacy.test.js' }, () =>
      op.runRuntimeExecute(dir, null, { executor: exec(dir), skipPreflight: true, checkpointCommits: true, wave: 1 }));
    assert.equal(planOf(dir).tasks[0].done, true);
  });

  it('a real red (green before) fails the checkpoint AND the next task never starts', async () => {
    const dir = project({ plan: base(), files, config: cfg });
    const calls = [];
    const res = await withEnv({ OXE_TEST_RED: 'tests/integration/remote.test.js', OXE_TEST_RED_BEFORE: '' }, () =>
      op.runRuntimeExecute(dir, null, { executor: exec(dir, calls), skipPreflight: true, checkpointCommits: true }));
    assert.deepEqual(calls, ['T1'], 'T2 never starts on top of T1\'s uncommitted work');
    assert.equal(res.result.status, 'checkpoint_failed');
    assert.equal(res.result.stopped_after_checkpoint_failure, true);
    assert.equal(planOf(dir).tasks[0].checkpoint_failed.kind, 'scope_insufficient');
  });
});

describe('OXB-176: a reopened task whose work is already in the tree commits it; its dependents wait for the commit', () => {
  it('A is reopened with its edits in the tree and writes nothing: A commits them, then B starts', async () => {
    const plan = { schema_version: 1, tasks: [
      { id: 'T1', title: 'A thread.place.gone', wave: 1, files: ['src/messages.ts'], verify: { commands: [ok] } },
      { id: 'T2', title: 'B uses it', wave: 2, depends_on: ['T1'], files: ['src/thread.ts'], verify: { commands: [ok] } },
    ] };
    const dir = project({ plan, files: { 'src/messages.ts': 'm0\n', 'src/thread.ts': 't0\n' } });
    // run 1 (rc.31): A ran and "completed" — its edits stayed uncommitted
    const first = { async execute(node) { if (node.id === 'T1') fs.writeFileSync(path.join(dir, 'src', 'messages.ts'), 'm1 thread.place.gone\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor: first, skipPreflight: true, wave: 1 });
    op.runtimePlanReopen(dir, null, { task: 'T1' });
    assert.notEqual(planOf(dir).tasks[0].done, true);
    // run 2 (rc.32): A's new attempt changes nothing; B writes its file
    const order = [];
    const second = { async execute(node) {
      order.push(`${node.id}@${git(dir, 'log', '--format=%s', '-1').stdout.trim()}`);
      if (node.id === 'T2') fs.writeFileSync(path.join(dir, 'src', 'thread.ts'), 't1\n');
      return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
    } };
    await op.runRuntimeExecute(dir, null, { executor: second, skipPreflight: true, checkpointCommits: true });
    const tasks = planOf(dir).tasks;
    const a = tasks.find((t) => t.id === 'T1');
    assert.equal(a.done, true, JSON.stringify(a.checkpoint_failed));
    assert.equal(git(dir, 'show', `${a.done_commit}:src/messages.ts`).stdout, 'm1 thread.place.gone\n', 'A commits its own leftovers');
    assert.ok(order[1] && order[1].startsWith('T2@'), JSON.stringify(order));
    assert.notEqual(order[1], 'T2@init', 'B starts only after A\'s commit');
    assert.equal(tasks.find((t) => t.id === 'T2').done, true);
  });
});
