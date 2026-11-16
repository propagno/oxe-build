'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ic = require('../bin/lib/oxe-integration-checks.cjs');
const resume = require('../bin/lib/oxe-resume.cjs');
const parallel = require('../bin/lib/oxe-parallel.cjs');
const taskGates = require('../bin/lib/oxe-task-gates.cjs');
const budget = require('../bin/lib/oxe-budget.cjs');
const trace = require('../bin/lib/oxe-trace.cjs');
const repair = require('../bin/lib/oxe-repair.cjs');
const recovery = require('../bin/lib/oxe-recovery.cjs');
const turns = require('../bin/lib/oxe-turns.cjs');

const dirs = [];
afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* Windows lock */ }
  }
});

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

describe('Round 19: integration-checks, resume, parallel, task-gates, budget, trace, repair, recovery, turns', () => {
  it('oxe-integration-checks: respects core.hooksPath, unquoted UTF-8 parked files, and oxe.config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-r19-ic-'));
    dirs.push(dir);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);
    git(dir, ['config', 'core.hooksPath', '.githooks']);

    const p1 = ic.installPrePushHook(dir);
    const p2 = ic.installCommitMsgHook(dir);
    assert.equal(p1.installed, true);
    assert.equal(p2.installed, true);
    assert.equal(p1.path, path.join(dir, '.githooks', 'pre-push'));
    assert.equal(p2.path, path.join(dir, '.githooks', 'commit-msg'));

    // Accented parked file tracked in git index is detected without octal-quote mismatch
    const parkedFile = path.join(dir, 'tests', 'acceptance', 'parked-f7', 'sessão.test.ts');
    fs.mkdirSync(path.dirname(parkedFile), { recursive: true });
    fs.writeFileSync(parkedFile, 'it("x", () => {});\n', 'utf8');
    git(dir, ['add', '.']);
    const found = ic.findTrackedParkedAcceptance(dir);
    assert.deepEqual(found, ['tests/acceptance/parked-f7/sessão.test.ts']);

    // oxe.config.json disables integration_checks when .oxe/config.json is absent
    fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({ integration_checks: false }), 'utf8');
    assert.deepEqual(ic.integrationCommands(dir), []);
  });

  it('oxe-resume: restores both sides of git rename on resetTaskFiles, blocks path traversal, and tracks AttemptStarted/TaskDeferred', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-r19-res-'));
    dirs.push(dir);
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@oxe.local']);
    git(dir, ['config', 'user.name', 'OXE Test']);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'old.ts'), 'export const x = 1;\n', 'utf8');
    git(dir, ['add', '.']);
    const baseSha = git(dir, ['commit', '-qm', 'init']) || git(dir, ['rev-parse', 'HEAD']);

    // Simulate staged rename `src/old.ts -> src/new.ts`
    git(dir, ['mv', 'src/old.ts', 'src/new.ts']);
    const diffs = resume.collectDirtyDiffs(dir);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].path, 'src/new.ts');
    assert.equal(diffs[0].renamed_from, 'src/old.ts');

    // Attempt traversal outside root is ignored; rename restores src/old.ts and removes src/new.ts
    const outside = path.join(os.tmpdir(), `oxe-r19-outside-${process.pid}.txt`);
    fs.writeFileSync(outside, 'keep', 'utf8');
    try {
      resume.resetTaskFiles(dir, baseSha, [...diffs, { path: `../${path.basename(outside)}` }]);
      assert.equal(fs.existsSync(outside), true, 'must never delete outside projectRoot');
      assert.equal(fs.existsSync(path.join(dir, 'src', 'old.ts')), true, 'renamed_from must be restored');
      assert.equal(fs.existsSync(path.join(dir, 'src', 'new.ts')), false, 'renamed target must be removed');
    } finally {
      fs.rmSync(outside, { force: true });
    }

    // AttemptStarted marks in_progress; TaskDeferred clears it
    const plan = { tasks: [{ id: 'T1', title: 'A', files: ['src/old.ts'] }, { id: 'T2', title: 'B', files: ['src/b.ts'] }] };
    const inProg = resume.findInProgressTasks(plan, [
      { type: 'AttemptStarted', work_item_id: 'T1', timestamp: '2026-11-16T00:00:00Z', payload: {} },
      { type: 'AttemptStarted', work_item_id: 'T2', timestamp: '2026-11-16T00:01:00Z', payload: {} },
      { type: 'TaskDeferred', work_item_id: 'T1', timestamp: '2026-11-16T00:02:00Z', payload: {} },
    ]);
    assert.deepEqual(inProg.map((t) => t.id), ['T2']);
  });

  it('oxe-parallel: refuses symlinks and out-of-root paths during integrate, and merges oxe.config.json', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-r19-par-'));
    dirs.push(base);
    const proj = path.join(base, 'proj');
    const leaseRoot = path.join(base, 'lease');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.mkdirSync(path.join(leaseRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'oxe.config.json'), JSON.stringify({ parallel: { max: 4 } }), 'utf8');

    const cfg = parallel.parallelConfig(proj);
    assert.equal(cfg.maxParallel, 4);

    // Path traversal entry in workingTreeChanges is rejected
    const fakeRuntime = { GitWorktreeManager: class {} };
    const pOpts = parallel.createParallelOptions(fakeRuntime, proj, cfg, {
      workingTreeChanges: () => [{ path: '../escape.ts', status: 'A' }],
    });
    const esc = pOpts.integrate({ id: 'T1', mutation_scope: ['../*'] }, { root_path: leaseRoot });
    assert.equal(esc.ok, false);
    assert.match(esc.error, /fora do workspace/);

    // Symlink inside worktree is refused on integrate
    const targetSecret = path.join(base, 'secret.txt');
    fs.writeFileSync(targetSecret, 'TOP_SECRET', 'utf8');
    let symlinkCreated = false;
    try {
      fs.symlinkSync(targetSecret, path.join(leaseRoot, 'src', 'leak.ts'));
      symlinkCreated = true;
    } catch { /* Windows without Developer Mode may refuse file symlinks */ }
    if (symlinkCreated) {
      const pSym = parallel.createParallelOptions(fakeRuntime, proj, cfg, {
        workingTreeChanges: () => [{ path: 'src/leak.ts', status: 'A' }],
      });
      const symRes = pSym.integrate({ id: 'T1', mutation_scope: ['src/**'] }, { root_path: leaseRoot });
      assert.equal(symRes.ok, false);
      assert.match(symRes.error, /symlink recusado/);
      assert.equal(fs.existsSync(path.join(proj, 'src', 'leak.ts')), false);
    }
  });

  it('oxe-task-gates & oxe-budget: preserves $& / $[id] filenames without replacement corruption and blocks NaN/Infinity/traversal in budget', () => {
    const gates = taskGates.collectTaskGates({
      task_gates: [{ id: 'lint', command: 'npx eslint {files}', runner: 'sh -c {command}' }],
    }, null);
    const cmds = taskGates.taskGateCommands(
      { id: 'T1', files: ['src/$&store.ts', 'src/routes/[id]/page.tsx'] },
      gates,
      { task_suite_command: 'npx vitest run {suites}' }
    );
    assert.equal(cmds.length, 1);
    assert.ok(cmds[0].command.includes('\\$&store.ts') || cmds[0].command.includes('$&store.ts'), `unexpected command: ${cmds[0].command}`);
    assert.ok(!cmds[0].command.includes('{files}'), 'must not re-insert {files} via $& backreference');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-r19-bgt-'));
    dirs.push(dir);
    assert.throws(() => budget.ledgerPath(dir, '../evil'), /inválido/);
    const led = budget.openBudget(dir, 'run-1', { turns: 20, usd: 10 });
    budget.recordUsage(dir, led, { turns: Infinity, cost_usd: NaN });
    budget.recordUsage(dir, led, { turns: -5, cost_usd: -3 });
    budget.recordUsage(dir, led, { turns: 4, cost_usd: 1.25 });
    assert.equal(led.used_turns, 4);
    assert.equal(led.used_usd, 1.25);
  });

  it('oxe-trace, oxe-repair, oxe-recovery & oxe-turns: object files in trace, ID collision & acceptance rewire in repair, quoted paths in recovery, L->90 turn escalation', () => {
    // 1. oxe-trace with `{ path, sha256 }` frozen test objects and shared card keys
    const g = trace.build({
      stories: [{ id: 'US-1', criteria: ['A1'], requirements: ['R1'], cards: ['OXE-20'] }],
      criteria: [{ id: 'A1', text: 'Critério OXE-20', risk: 'P1' }],
      requirements: [{ id: 'R1', version: 'v1', criteria: ['A1'] }],
      decisions: [],
      rfcs: [],
      tasks: [{ id: 'T1', acceptance: ['A1'] }],
      tests: [{ criterion: 'A1', files: [{ path: 'tests/acceptance/a1.test.ts', sha256: 'deadbeef' }] }],
      changes: [],
      links: new Map([['US-1', { ref: 'US-1', key: 'OXE-20', kind: 'story' }]]),
      cardSpecs: new Map([['OXE-20', [{ id: 'CA-1', spec_id: 'A1' }]]]),
      checks: [{ check_id: 'check-accept-a1', acceptance_ref: 'A1', status: 'pass' }],
      phase: 'F1',
      almConfigured: true,
      storiesSource: 'prd',
      cardKeysOf: () => ['OXE-20'],
    });
    assert.equal(g.counts.cards, 1, 'OXE-20 must not be double-counted across links + cardSpecs');
    const docComment = trace.cardDocs({ story: 'US-1', criteria: g.stories[0].criteria, decisions: [] }, {});
    assert.match(docComment, /teste tests\/acceptance\/a1\.test\.ts/);
    assert.doesNotMatch(docComment, /\[object Object\]/);

    // 2. oxe-repair: re-allocates colliding subtask IDs, rewires acceptance_tests.task, and blocks double-apply
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-r19-rep-'));
    dirs.push(dir);
    const planDoc = {
      schema_version: 1,
      acceptance_tests: [
        { criterion: 'A1', task: 'T1', files: ['tests/a1.test.ts'], command: 'vitest a1' },
        { criterion: 'A2', task: 'T1', files: ['tests/a2.test.ts'], command: 'vitest a2' },
      ],
      tasks: [
        { id: 'T1', title: 'Big', wave: 1, files: ['src/a.ts'], acceptance: ['A1', 'A2'], verify: { commands: ['vitest'] } },
        { id: 'T2', title: 'Consumer', wave: 2, files: ['src/b.ts'], depends_on: ['T1'] },
      ],
    };
    const dec = repair.decide(planDoc.tasks[0], planDoc, { attempt: 2, failureClass: 'verify', output: '', verifySuspect: true, config: {} });
    assert.equal(dec.strategy, 'decompose');
    repair.writeProposal(dir, planDoc.tasks[0], planDoc, dec);
    // Simulate T3 appended before applyProposal -> proposal's T3 collides and must remap to T4/T5!
    planDoc.tasks.push({ id: 'T3', title: 'Added meanwhile', wave: 1, files: ['src/c.ts'] });
    const jsonPath = path.join(dir, 'PLAN.json');
    const applied = repair.applyProposal(dir, jsonPath, planDoc, 'T1');
    assert.deepEqual(applied.into.map((x) => x.id), ['T4', 'T5']);
    assert.equal(planDoc.acceptance_tests[0].task, 'T4');
    assert.equal(planDoc.acceptance_tests[1].task, 'T5');
    assert.deepEqual(planDoc.tasks.find((t) => t.id === 'T2').depends_on, ['T5']);
    assert.throws(() => repair.applyProposal(dir, jsonPath, planDoc, 'T1'), /já foi aplicada/);

    // 3. oxe-recovery quotes paths with parentheses/spaces
    const rec = recovery.recoveryStep(dir, null, {
      run: {},
      doc: {
        tasks: [{
          id: 'T1',
          done: false,
          checkpoint_failed: { kind: 'scope_insufficient', related_red: ['src/(auth)/login test.ts'] },
        }],
      },
      programDir: path.join(dir, '.oxe', 'program'),
      phase: null,
    });
    assert.match(rec.cursorCmd, /"src\/\(auth\)\/login test\.ts"/);

    // 4. oxe-turns escalates L tasks on turns_exhausted (60 -> 90) and skips superseded tasks in turnWarnings
    const sizer = turns.createTurnSizer(
      {},
      new Map([['T1', { id: 'T1', size: 'L', files: ['a.ts'] }]]),
      new Map()
    );
    assert.equal(sizer('T1', 1, null), 60);
    assert.equal(sizer('T1', 2, 'turns_exhausted'), 90);
    const tw = turns.turnWarnings(
      { tasks: [{ id: 'T9', size: 'L', superseded: { by_phase: 'F7' } }] },
      null,
      { runtime: { provider: { maxTurns: 20 } } }
    );
    assert.deepEqual(tw, []);
  });
});
