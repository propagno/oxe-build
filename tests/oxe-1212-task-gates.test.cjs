'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const gates = require('../bin/lib/oxe-task-gates.cjs');

// 1.21.2 — OXB-048: F1-T4 (workspaces.color, migration 093) went green on its own tests while the typecheck and
// tests/integration/migrations.test.ts were red. Task gates run on every code task's verify.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const node = (code) => `node -e "${code}"`;
const ok = node('process.exit(0)');
// A "typecheck" that fails while src/types.js lacks `color` (the T4 evidence).
const fakeTsc = node("process.exit(require('fs').readFileSync('src/types.js','utf8').includes('color')?0:2)");

function project({ plan, config = {}, files = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-tg-'));
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
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

const graphNode = (compiled, id) => {
  const nodes = compiled.graph.nodes;
  return Array.isArray(nodes) ? nodes.find((n) => n.id === id) : nodes[id];
};

describe('OXB-048: task_gates', () => {
  it('appends the gates to code tasks only; {files} expands to the matching files; affected_suites via task_suite_command', () => {
    const plan = {
      schema_version: 1,
      task_gates: [{ id: 'related', command: 'npx vitest related --run {files}', applies_to: '\\.tsx?$' }],
      tasks: [
        { id: 'T4', title: 'migração', wave: 1, files: ['electron/main/db/migrations/093.ts', 'src/types.ts', 'docs/x.md'], affected_suites: ['tests/integration/migrations.test.ts'], verify: { commands: ['npx vitest run tests/t4.test.ts'] } },
        { id: 'T5', title: 'docs', wave: 1, files: ['docs/y.md'], verify: { commands: [ok] } },
        { id: 'T6', title: 'externa', wave: 1, kind: 'external_delivery', blocked_by: ['o/r#1'], files: ['src/z.ts'], verify: { commands: [ok] } },
      ],
    };
    const config = { task_gates: [{ id: 'tsc', command: 'npx tsc --noEmit --incremental' }, { id: 'related', command: 'IGNORED (the plan wins)' }], task_suite_command: 'npx vitest run {suites}' };
    const dir = project({ plan, config });
    const compiled = op.compileExecutionGraphFromArtifacts(dir, null, {});
    const t4 = graphNode(compiled, 'T4');
    assert.equal(t4.verify.command, 'npx vitest run tests/t4.test.ts && npx tsc --noEmit --incremental && npx vitest related --run electron/main/db/migrations/093.ts src/types.ts && npx vitest run tests/integration/migrations.test.ts');
    assert.deepEqual(t4.verify.task_gates, ['task-gate-tsc', 'task-gate-related', 'affected-suites']);
    assert.equal(graphNode(compiled, 'T5').verify.command, ok, 'a docs-only task gets no gates');
    assert.ok(!(graphNode(compiled, 'T6') && graphNode(compiled, 'T6').verify && graphNode(compiled, 'T6').verify.task_gates), 'an external delivery gets no gates');
  });

  it('a red gate fails the attempt and the retry names the gate segment (OXB-066); fixed on retry, the task completes', async () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T4', title: 'color', wave: 1, files: ['src/types.js'], verify: { commands: [ok] } }] };
    const dir = project({ plan, config: { task_gates: [{ id: 'tsc', command: fakeTsc }] }, files: { 'src/types.js': 'module.exports = {};\n' } });
    let attempt = 0;
    const retries = [];
    const executor = {
      async execute(n, ctx) {
        attempt += 1;
        // 1st attempt: only its own change (types without color, the gate stays red); 2nd: fixes the type.
        fs.writeFileSync(path.join(dir, 'src', 'types.js'), attempt === 1 ? 'module.exports = { name: 1 };\n' : 'module.exports = { name: 1, color: 2 };\n');
        return { success: true, failure_class: null, evidence: ['src/types.js'], output: 'ok', completed_by: 'finish_task' };
      },
    };
    const res = await op.runRuntimeExecute(dir, null, {
      executor,
      skipPreflight: true,
      onProgress: (e) => { if (e.type === 'RetryScheduled') retries.push(e.payload.output_tail); },
    });
    assert.deepEqual(res.result.completed, ['T4']);
    assert.equal(retries.length, 1);
    assert.match(retries[0], /Failing segment \[2\/2\]/);
  });

  it('changing task_gates in config.json changes the source hash (the graph recompiles)', () => {
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['a.ts'], verify: { commands: [ok] } }] };
    const dir = project({ plan });
    const before = op.planSourceHash(dir, null);
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ task_gates: [{ id: 'tsc', command: 'npx tsc --noEmit' }] }));
    assert.notEqual(op.planSourceHash(dir, null), before);
  });

  it('lint: invalid task_gates is an error; a suite rule without its suite and affected_suites without a command warn', () => {
    const doc = {
      task_gates: [{ id: '1bad', command: '' }],
      tasks: [
        { id: 'T4', files: ['electron/main/db/migrations/093.ts'], verify: { commands: ['npx vitest run tests/t4.test.ts'] } },
        { id: 'T5', files: ['electron/main/db/migrations/094.ts'], affected_suites: ['tests/integration/migrations.test.ts'] },
        { id: 'T6', files: ['electron/main/db/migrations/095.ts'], verify: { commands: ['npx vitest run tests/integration/migrations.test.ts'] } },
      ],
    };
    const config = { suite_rules: [{ paths: '^electron/main/db/migrations/', suite: 'tests/integration/migrations.test.ts', reason: 'EXPECTED_SCHEMA_VERSION' }] };
    const out = gates.lintTaskGates(doc, config);
    assert.ok(out.errors.some((e) => /task_gates\[0\]\.id/.test(e)));
    assert.ok(out.errors.some((e) => /task_gates\[0\]\.command/.test(e)));
    assert.deepEqual(out.warnings.filter((w) => /sem a suíte/.test(w)).map((w) => w.slice(0, 2)), ['T4']);
    assert.ok(out.warnings.some((w) => /T5: affected_suites declarado, mas .* task_suite_command/.test(w)));
  });
});
