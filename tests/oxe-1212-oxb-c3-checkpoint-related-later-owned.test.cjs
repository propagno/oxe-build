'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const si = require('../bin/lib/oxe-suite-impact.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(cwd, ...args) {
  return spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

function makeRepo({ plan, files = {}, config = {}, spec = '# SPEC\n\n## Critérios\n- A38: persist scope\n- A41: pin a11y\n- A43: changes badge\n- A54: first run\n- A99: orphan\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-oxb-c3-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), spec, 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n\n## Tarefas\n- [ ] T39: test\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  for (const a of (plan && Array.isArray(plan.acceptance_tests) ? plan.acceptance_tests : [])) {
    for (const f of (a && a.files) || []) {
      const rel = typeof f === 'string' ? f : f && f.path;
      if (rel && !(rel in files)) {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, '// frozen stub\n', 'utf8');
      }
    }
  }
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@oxe.dev');
  git(dir, 'config', 'user.name', 'OXE Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const okCmd = 'node -e "process.exit(0)"';

describe('OXB-C3: checkpoint_related_tests applies G38 later-owned pruning and separates report categories', () => {
  it('failingTestFiles parses remote-verify GH Actions tab/timestamp prefixes, ANSI codes, Vitest |project| badges, and CI runner paths', () => {
    const dir = makeRepo({
      plan: { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.ts'] }] },
      files: {
        'src/a.ts': 'export const a = 1;\n',
        'tests/oxe152/pu/pu03-first-run-forced.test.tsx': '// frozen\n',
      },
    });
    const ciLog = [
      'verify\tRun remote command\t2026-11-16T13:38:12.3456789Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m |unit| tests/oxe152/ag/ag04d-changes-badge.test.tsx > badge count updates',
      'verify\tRun remote command\t2026-11-16T13:38:12.4000000Z  FAIL  [renderer] tests/oxe152/ag/ag04c-pin-a11y.test.tsx [ tests/oxe152/ag/ag04c-pin-a11y.test.tsx ]',
      'verify\tRun remote command\t2026-11-16T13:38:12.5000000Z \x1b[31m❯\x1b[39m /home/runner/work/oxespace/oxespace/tests/oxe152/pu/pu03-first-run-forced.test.tsx:14:3',
      'verify\tRun remote command\t2026-11-16T13:38:12.6000000Z  FAIL  |electron| electron/main/__tests__/db-replay.native.test.ts [ electron/main/__tests__/db-replay.native.test.ts ]',
    ].join('\n');
    const parsed = op.failingTestFiles(ciLog, { projectRoot: dir });
    assert.deepEqual(
      parsed.map((p) => p.file),
      [
        'tests/oxe152/ag/ag04d-changes-badge.test.tsx',
        'tests/oxe152/ag/ag04c-pin-a11y.test.tsx',
        'tests/oxe152/pu/pu03-first-run-forced.test.tsx',
        'electron/main/__tests__/db-replay.native.test.ts',
      ],
    );
    assert.deepEqual(parsed[0].names, ['badge count updates']);
    assert.deepEqual(parsed[1].names, []);
  });

  it('reproduces F6 T39 (wave 14): prunes T41/T43/T54 later-owned + superseded + unowned frozen tests via G38 without rerunning them, filters native ABI & parent reds, and commits cleanly', async () => {
    const rerunLogPath = path.join(os.tmpdir(), `oxe-c3-reruns-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    const relatedScript = [
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:00.0000000Z \\x1b[41m FAIL \\x1b[49m |unit| tests/oxe152/ag/ag04d-changes-badge.test.tsx > badge');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:01.0000000Z  FAIL  tests/oxe152/ag/ag04c-pin-a11y.test.tsx > pin a11y');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:02.0000000Z  FAIL  tests/oxe152/pu/pu03-first-run-forced.test.tsx > forced');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:03.0000000Z  FAIL  tests/oxe152/f7/superseded-card.test.tsx > moved to F7');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:04.0000000Z  FAIL  tests/oxe152/orphan-unowned.test.tsx > orphan criterion');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:05.0000000Z  FAIL  |electron| electron/main/__tests__/db-replay.native.test.ts [ electron/main/__tests__/db-replay.native.test.ts ]');",
      "console.log('Error: The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 128 (ERR_DLOPEN_FAILED)');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:06.0000000Z  FAIL  src/components/__tests__/TerminalView.test.tsx > pty resize');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:07.0000000Z  FAIL  electron/main/__tests__/policy-tool-use-enforcement.test.ts > policy');",
      "console.log('verify\\tRun remote-verify\\t2026-11-16T13:39:08.0000000Z  Test Files  \\x1b[31m8 failed\\x1b[39m | 34 passed (42)');",
      'process.exit(1);',
    ].join('\n');

    // Solo/parent runner:
    // - logs every invocation so we prove later-owned tests are NEVER re-run
    // - TerminalView passes solo (parallel flake)
    // - policy-tool-use-enforcement fails both on commit and on parent (pre-existing red)
    const rerunScript = [
      "const fs = require('fs');",
      'const args = process.argv.slice(2);',
      `fs.appendFileSync(${JSON.stringify(rerunLogPath)}, JSON.stringify(args) + '\\n');`,
      "if (args.length === 1 && args[0] === 'src/components/__tests__/TerminalView.test.tsx') process.exit(0);",
      "if (args.includes('electron/main/__tests__/policy-tool-use-enforcement.test.ts')) {",
      "  console.log('\\x1b[41m FAIL \\x1b[49m |electron| electron/main/__tests__/policy-tool-use-enforcement.test.ts > policy');",
      '  process.exit(1);',
      '}',
      'process.exit(0);',
    ].join('\n');

    const plan = {
      schema_version: 1,
      phase: 'F6',
      tasks: [
        { id: 'T39', title: 'Changes panel shared wiring', wave: 14, files: ['src/changes-panel.tsx'], acceptance: ['A39'], verify: { commands: [okCmd] } },
        // T41 owns ag04c-pin-a11y via hierarchical subcriterion A41.1 ↔ entry criterion A41
        { id: 'T41', title: 'Pin a11y', wave: 15, depends_on: ['T39'], files: ['src/pin.tsx'], acceptance: ['A41.1'], verify: { commands: [okCmd] } },
        // T43 owns ag04d-changes-badge via T43.verify.commands (even without an acceptance_tests entry)
        { id: 'T43', title: 'Changes badge', wave: 16, depends_on: ['T39'], files: ['src/badge.tsx'], acceptance: ['A43'], verify: { commands: ['node scripts/remote-verify.mjs -- npx vitest run tests/oxe152/ag/ag04d-changes-badge.test.tsx'] } },
        // T54 owns pu03-first-run-forced via acceptance_tests.task
        { id: 'T54', title: 'First run forced', wave: 22, depends_on: ['T39'], files: ['src/first-run.tsx'], acceptance: ['A54'], verify: { commands: [okCmd] } },
      ],
      acceptance_tests: [
        { criterion: 'A41', files: ['tests/oxe152/ag/ag04c-pin-a11y.test.tsx'], command: 'npx vitest run tests/oxe152/ag/ag04c-pin-a11y.test.tsx' },
        { criterion: 'A54', task: 'T54', files: ['tests/oxe152/pu/pu03-first-run-forced.test.tsx'], command: 'npx vitest run tests/oxe152/pu/pu03-first-run-forced.test.tsx' },
        // Unowned criterion A99 (0 matching tasks in tasks[]) — previously triggered `[].every(...) === true` vacuous truth!
        { criterion: 'A99', files: ['tests/oxe152/orphan-unowned.test.tsx'], command: 'npx vitest run tests/oxe152/orphan-unowned.test.tsx' },
      ],
      superseded_tests: [
        { criterion: 'A60', files: ['tests/oxe152/f7/superseded-card.test.tsx'], command: 'npx vitest run tests/oxe152/f7/superseded-card.test.tsx', superseded: { by_phase: 'F7', tasks: ['T60'] } },
      ],
    };

    const dir = makeRepo({
      plan,
      files: {
        'src/changes-panel.tsx': 'export const v = 1;\n',
        'src/pin.tsx': 'export const pin = 0;\n',
        'src/badge.tsx': 'export const badge = 0;\n',
        'src/first-run.tsx': 'export const fr = 0;\n',
        'related.js': relatedScript,
        'related-run.js': rerunScript,
      },
      config: {
        checkpoint_related_tests: {
          command: 'node related.js {files}',
          run_command: 'node related-run.js {files}',
        },
      },
    });

    try {
      const exec = {
        async execute(node) {
          if (node.id === 'T39') fs.writeFileSync(path.join(dir, 'src', 'changes-panel.tsx'), 'export const v = 2;\n', 'utf8');
          return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
        },
      };
      const res = await op.runRuntimeExecute(dir, null, { executor: exec, skipPreflight: true, checkpointCommits: true, wave: 14 });
      assert.equal(res.result.checkpoint_failed, undefined, JSON.stringify(res.result.checkpoint_failed));

      const savedPlan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
      const t39 = savedPlan.tasks.find((t) => t.id === 'T39');
      assert.equal(t39.done, true);
      assert.ok(t39.done_commit);

      // Verify none of the G38 later-owned / superseded / orphan tests nor the native ABI suite was ever re-run
      const rerunInvocations = fs.existsSync(rerunLogPath)
        ? fs.readFileSync(rerunLogPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).flatMap((l) => JSON.parse(l))
        : [];
      for (const pruned of [
        'tests/oxe152/ag/ag04d-changes-badge.test.tsx',
        'tests/oxe152/ag/ag04c-pin-a11y.test.tsx',
        'tests/oxe152/pu/pu03-first-run-forced.test.tsx',
        'tests/oxe152/f7/superseded-card.test.tsx',
        'tests/oxe152/orphan-unowned.test.tsx',
        'electron/main/__tests__/db-replay.native.test.ts',
      ]) {
        assert.equal(rerunInvocations.includes(pruned), false, `${pruned} must NOT be re-run`);
      }

      const gateEv = op.readEvents(dir, null).find((e) => e.type === 'GateResolved' && e.payload.gate === 'checkpoint' && e.work_item_id === 'T39');
      assert.ok(gateEv && gateEv.payload && gateEv.payload.check);
      assert.equal(gateEv.payload.check.related_set_size, 42);
      const laterByFile = new Map((gateEv.payload.check.later_owned_reds || []).map((x) => [x.file, x]));
      assert.equal(laterByFile.get('tests/oxe152/ag/ag04d-changes-badge.test.tsx').owner, 'T43');
      assert.equal(laterByFile.get('tests/oxe152/ag/ag04d-changes-badge.test.tsx').owner_wave, 16);
      assert.equal(laterByFile.get('tests/oxe152/ag/ag04c-pin-a11y.test.tsx').owner, 'T41');
      assert.equal(laterByFile.get('tests/oxe152/ag/ag04c-pin-a11y.test.tsx').owner_wave, 15);
      assert.equal(laterByFile.get('tests/oxe152/pu/pu03-first-run-forced.test.tsx').owner, 'T54');
      assert.equal(laterByFile.get('tests/oxe152/pu/pu03-first-run-forced.test.tsx').owner_wave, 22);
      assert.equal(laterByFile.get('tests/oxe152/f7/superseded-card.test.tsx').owner, 'F7');
      assert.deepEqual(
        [...(gateEv.payload.check.preexisting_reds || [])].sort(),
        [
          'electron/main/__tests__/db-replay.native.test.ts',
          'electron/main/__tests__/policy-tool-use-enforcement.test.ts',
        ],
      );
      assert.deepEqual(gateEv.payload.check.flaky_reds, [
        { file: 'src/components/__tests__/TerminalView.test.tsx', first: 'red', rerun: 'green', where: 'commit_worktree' },
      ]);
    } finally {
      fs.rmSync(rerunLogPath, { force: true });
    }
  });

  it('separates "regressão real" from "congelado de tarefa posterior" when both occur on the same checkpoint', async () => {
    const relatedScript = [
      "console.log(' FAIL  tests/unit/changes-store.test.ts > keeps dirty count synced');",
      "console.log(' FAIL  tests/oxe152/ag/ag04d-changes-badge.test.tsx > badge');",
      "console.log(' FAIL  tests/oxe152/ag/ag04c-pin-a11y.test.tsx > pin a11y');",
      'process.exit(1);',
    ].join('\n');
    // Real regression: green on parent (v1), red on commit (v2)
    const rerunScript = [
      "const fs = require('fs');",
      'const args = process.argv.slice(2);',
      "const code = fs.readFileSync('src/changes-panel.tsx', 'utf8');",
      "if (args.includes('tests/unit/changes-store.test.ts') && code.includes('v = 2')) {",
      "  console.log(' FAIL  tests/unit/changes-store.test.ts > keeps dirty count synced');",
      '  process.exit(1);',
      '}',
      'process.exit(0);',
    ].join('\n');

    const plan = {
      schema_version: 1,
      phase: 'F6',
      tasks: [
        { id: 'T39', title: 'Changes panel', wave: 14, files: ['src/changes-panel.tsx'], verify: { commands: [okCmd] } },
        { id: 'T41', title: 'Pin a11y', wave: 15, depends_on: ['T39'], files: ['src/pin.tsx'], acceptance: ['A41'], verify: { commands: [okCmd] } },
        { id: 'T43', title: 'Changes badge', wave: 16, depends_on: ['T39'], files: ['src/badge.tsx'], acceptance: ['A43'], verify: { commands: [okCmd] } },
      ],
      acceptance_tests: [
        { criterion: 'A41', task: 'T41', files: ['tests/oxe152/ag/ag04c-pin-a11y.test.tsx'], command: 'x' },
        { criterion: 'A43', task: 'T43', files: ['tests/oxe152/ag/ag04d-changes-badge.test.tsx'], command: 'x' },
      ],
    };
    const dir = makeRepo({
      plan,
      files: {
        'src/changes-panel.tsx': 'export const v = 1;\n',
        'src/pin.tsx': 'export const p = 1;\n',
        'src/badge.tsx': 'export const b = 1;\n',
        'related.js': relatedScript,
        'related-run.js': rerunScript,
      },
      config: {
        checkpoint_related_tests: {
          command: 'node related.js {files}',
          run_command: 'node related-run.js {files}',
        },
      },
    });

    const exec = {
      async execute(node) {
        if (node.id === 'T39') fs.writeFileSync(path.join(dir, 'src', 'changes-panel.tsx'), 'export const v = 2;\n', 'utf8');
        return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' };
      },
    };
    const res = await op.runRuntimeExecute(dir, null, { executor: exec, skipPreflight: true, checkpointCommits: true, wave: 14 });
    assert.equal(res.result.status, 'checkpoint_failed');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const t39 = saved.tasks.find((t) => t.id === 'T39');
    assert.equal(t39.done, false);
    assert.equal(t39.checkpoint_failed.kind, 'scope_insufficient');
    assert.deepEqual(t39.checkpoint_failed.related_red, ['tests/unit/changes-store.test.ts']);
    assert.deepEqual(t39.checkpoint_failed.real_regressions, ['tests/unit/changes-store.test.ts']);
    assert.deepEqual(
      t39.checkpoint_failed.later_owned_reds,
      [
        { file: 'tests/oxe152/ag/ag04d-changes-badge.test.tsx', owner: 'T43', owner_wave: 16, criterion: 'A43' },
        { file: 'tests/oxe152/ag/ag04c-pin-a11y.test.tsx', owner: 'T41', owner_wave: 15, criterion: 'A41' },
      ],
    );
    assert.match(t39.checkpoint_failed.reason, /regressão real.*tests\/unit\/changes-store\.test\.ts/);
    assert.match(t39.checkpoint_failed.reason, /congelado de tarefa posterior \(ignorado por G38\):.*ag04d-changes-badge\.test\.tsx → T43 \(onda 16\)/);
  });

  it('still catches a regression on an ALREADY-COMPLETED task frozen test (never masks real regressions on earlier waves)', () => {
    const doc = {
      schema_version: 1,
      tasks: [
        { id: 'T33', title: 'Done header', wave: 10, done: true, status: 'done', files: ['src/header.tsx'], acceptance: ['A33'] },
        { id: 'T39', title: 'Current task', wave: 14, files: ['src/changes.tsx'], acceptance: ['A39'] },
        { id: 'T43', title: 'Later badge', wave: 16, files: ['src/badge.tsx'], acceptance: ['A43'] },
      ],
      acceptance_tests: [
        { criterion: 'A33', task: 'T33', files: ['tests/oxe152/brand/brd-14-header.test.tsx'], command: 'x' },
        { criterion: 'A43', task: 'T43', files: ['tests/oxe152/ag/ag04d-changes-badge.test.tsx'], command: 'x' },
      ],
    };
    const out = si.classifyRelatedTestFiles(doc, 'T39', [
      { file: 'tests/oxe152/brand/brd-14-header.test.tsx', names: ['chip'] },
      { file: 'tests/oxe152/ag/ag04d-changes-badge.test.tsx', names: ['badge'] },
    ]);
    assert.deepEqual(out.candidates.map((c) => c.file), ['tests/oxe152/brand/brd-14-header.test.tsx']);
    assert.deepEqual(out.later_owned.map((c) => [c.file, c.owner, c.owner_wave]), [
      ['tests/oxe152/ag/ag04d-changes-badge.test.tsx', 'T43', 16],
    ]);
  });

  it('proactively appends --exclude <file> to vitest related commands for pending later-owned frozen tests (keeping own & done tests in)', () => {
    const planDoc = {
      schema_version: 1,
      tasks: [
        { id: 'T39', title: 'Scope persist', wave: 14, files: ['src/store/ui.store.ts'], acceptance: ['A38'] },
        { id: 'T41', title: 'Pin a11y', wave: 16, files: ['src/pin.tsx'], acceptance: ['A37'] },
        { id: 'T42', title: 'Changed count', wave: 16, done: true, status: 'done', files: ['src/count.ts'], acceptance: ['A39'] },
        { id: 'T43', title: 'Changes badge', wave: 17, files: ['src/badge.tsx'], acceptance: ['A40'] },
        { id: 'T54', title: 'First run forced', wave: 28, files: ['src/first.tsx'], acceptance: ['A46'] },
      ],
      acceptance_tests: [
        { criterion: 'A38', task: 'T39', files: ['tests/oxe152/code/ag04b-pin-persist.test.ts'], command: 'x' },
        { criterion: 'A37', task: 'T41', files: ['tests/oxe152/code/ag04c-pin-a11y.test.tsx', 'e2e/polish/ag04c-pin-a11y.spec.ts'], command: 'x' },
        { criterion: 'A39', task: 'T42', files: ['tests/oxe152/code/ag04d-changed-files-count.test.ts'], command: 'x' },
        { criterion: 'A40', task: 'T43', files: ['tests/oxe152/code/ag04d-changes-badge.test.tsx'], command: 'x' },
        { criterion: 'A46', task: 'T54', files: ['tests/oxe152/polish/pu03-first-run-forced.test.tsx'], command: 'x' },
      ],
    };
    const cfg = {
      checkpoint_related_tests: {
        command: 'node scripts/remote-verify.mjs -- npx vitest related --run {files} --maxWorkers=2',
      },
    };
    const rel = op.relatedTestsCommand(cfg, ['src/store/ui.store.ts'], null, { task: planDoc.tasks[0], planDoc });
    assert.equal(rel.timeout, 30 * 60_000, 'remote-verify related default timeout is 30 min');
    assert.deepEqual(rel.excluded_later_owned, [
      'tests/oxe152/code/ag04c-pin-a11y.test.tsx',
      'tests/oxe152/code/ag04d-changes-badge.test.tsx',
      'tests/oxe152/polish/pu03-first-run-forced.test.tsx',
    ]);
    assert.match(rel.command, /--exclude tests\/oxe152\/code\/ag04d-changes-badge\.test\.tsx/);
    assert.doesNotMatch(rel.command, /ag04b-pin-persist\.test\.ts/, 'own frozen test stays included');
    assert.doesNotMatch(rel.command, /ag04d-changed-files-count\.test\.ts/, 'done task frozen test stays included');
    assert.doesNotMatch(rel.command, /e2e\/polish/, 'Playwright e2e is omitted from vitest --exclude');
  });

  it('runtimeCommitTask T39 recovers a checkpoint_failed task without LLM, filters native ABI on non-.native. suites too, and marks T39 done', () => {
    const relatedScript = [
      "console.log(' FAIL  tests/oxe152/code/ag04d-changes-badge.test.tsx > badge');",
      "console.log(' FAIL  tests/integration/policy-tool-use-enforcement.test.ts > policy');",
      "console.log('Error: The module better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 130 (ERR_DLOPEN_FAILED)');",
      'process.exit(1);',
    ].join('\n');
    const plan = {
      schema_version: 1,
      phase: 'F6',
      tasks: [
        {
          id: 'T39',
          title: 'Persist scope per pane',
          wave: 14,
          done: false,
          status: 'in_progress',
          files: ['src/store/ui.store.ts', 'src/components/Workspace/WorkspaceSurface.tsx'],
          acceptance: ['A38'],
          verify: { commands: [okCmd] },
          checkpoint_failed: {
            kind: 'related_tests',
            reason: 'old timeout',
            related_red: [],
          },
        },
        {
          id: 'T43',
          title: 'Changes badge',
          wave: 17,
          depends_on: ['T39'],
          files: ['src/components/Workspace/WorkspaceSurface.tsx'],
          acceptance: ['A40'],
          verify: { commands: [okCmd] },
        },
      ],
      acceptance_tests: [
        { criterion: 'A40', task: 'T43', files: ['tests/oxe152/code/ag04d-changes-badge.test.tsx'], command: okCmd },
      ],
    };
    const dir = makeRepo({
      plan,
      files: {
        'src/store/ui.store.ts': 'export const scope = "root";\n',
        'src/components/Workspace/WorkspaceSurface.tsx': 'export const Surface = () => null;\n',
        'tests/oxe152/code/ag04d-changes-badge.test.tsx': '// frozen T43\n',
        'related.js': relatedScript,
      },
      config: {
        checkpoint_related_tests: {
          command: 'node related.js {files}',
        },
      },
    });
    // Dirty T39's files (as left in the working tree after verify passed)
    fs.writeFileSync(path.join(dir, 'src', 'store', 'ui.store.ts'), 'export const scope = "pinned";\n', 'utf8');
    const out = op.runtimeCommitTask(dir, null, { task: 'T39', by: 'coord' });
    assert.equal(out.ok, true);
    assert.ok(out.commit);
    assert.deepEqual(out.check.later_owned_reds, [
      { file: 'tests/oxe152/code/ag04d-changes-badge.test.tsx', owner: 'T43', owner_wave: 17, criterion: 'A40' },
    ]);
    assert.deepEqual(out.check.preexisting_reds, ['tests/integration/policy-tool-use-enforcement.test.ts']);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const t39 = saved.tasks.find((t) => t.id === 'T39');
    assert.equal(t39.done, true);
    assert.equal(t39.checkpoint_failed, undefined);
  });
});
