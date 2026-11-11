'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const testScope = require('../bin/lib/oxe-test-scope.cjs');

// 1.21.2 — OXB-171 (TECH LEAD, F2 run oxe-run-mw83vtdy-8uzesq): T8 (R4) failed 3 attempts on
// tests/acceptance/f2/r4-removal.test.ts "its IPC channel groups are gone" — the test imports shared/types/ipc.ts,
// outside T8's files; 9 more F2 tasks had the same gap and lint stayed green; the events had no output tail.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

const TEST = [
  "import { channelGroups } from '../../../shared/types/ipc';",
  "import { removeRtk } from '../../../electron/main/rtk/remove';",
  "import { fx } from './fixtures/r4';",
  "const fs = require('fs');",
  "const raw = fs.readFileSync('shared/locales/en/settings.json', 'utf8');",
  "const p = require('path').join(__dirname, '..', '..', '..', 'electron', 'main', 'rtk', 'remove.ts');",
  "it('its IPC channel groups are gone', () => {});",
  '',
].join('\n');

function project({ files, tasks, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ts-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, ...config }));
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'tests/acceptance/f2/r4-removal.test.js', TEST);
  write(dir, 'tests/acceptance/f2/fixtures/r4.ts', 'export const fx = 1;\n');
  write(dir, 'shared/types/ipc.ts', "export const channelGroups = ['rtk'];\n");
  write(dir, 'electron/main/rtk/remove.ts', 'export const removeRtk = 1;\n');
  write(dir, 'shared/locales/en/settings.json', '{}\n');
  for (const [rel, c] of Object.entries(files || {})) write(dir, rel, c);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks, acceptance_tests: [{ criterion: 'A1', task: 'T8', files: ['tests/acceptance/f2/r4-removal.test.js'], command: 'node tests/acceptance/f2/r4-removal.test.js' }] }, null, 2));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  return dir;
}

describe('OXB-171: frozen test needs vs the task scope', () => {
  it('testRequirements: static imports and literal reads, resolved; fixtures of the tests tree are not product', () => {
    const dir = project({ tasks: [{ id: 'T8', title: 'R4', wave: 1, files: ['electron/main/rtk/remove.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] });
    const req = testScope.testRequirements(dir, 'tests/acceptance/f2/r4-removal.test.js').map((r) => `${r.kind}:${r.path}`).sort();
    assert.deepEqual(req, ['import:electron/main/rtk/remove.ts', 'import:shared/types/ipc.ts', 'read:shared/locales/en/settings.json']);
  });

  it('plan lint flags the F2 shape: "T8: … importa shared/types/ipc.ts, fora de files"; a dependency owning it is fine', () => {
    const dir = project({ tasks: [{ id: 'T8', title: 'R4', wave: 1, files: ['electron/main/rtk/remove.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] });
    const lint = op.runtimePlanLint(dir, null, {});
    const msgs = lint.warnings.filter((w) => /fora de files/.test(w));
    assert.ok(msgs.some((w) => /^T8: o teste congelado tests\/acceptance\/f2\/r4-removal\.test\.js importa shared\/types\/ipc\.ts, fora de files/.test(w)), msgs.join('\n'));
    assert.ok(msgs.some((w) => /lê shared\/locales\/en\/settings\.json/.test(w)));
    assert.ok(!msgs.some((w) => /remove\.ts|fixtures/.test(w)), 'in scope / fixtures are not flagged');
    // lint.test_scope: "error"
    write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, lint: { test_scope: 'error' } }));
    assert.ok(op.runtimePlanLint(dir, null, {}).errors.some((e) => /importa shared\/types\/ipc\.ts/.test(e)));
    // a task T8 depends on owns ipc.ts and the locales → no gap
    const dir2 = project({ tasks: [
      { id: 'T3', title: 'ipc', wave: 1, files: ['shared/types/ipc.ts', 'shared/locales/'], verify: { commands: ['node -e 0'] } },
      { id: 'T8', title: 'R4', wave: 2, depends_on: ['T3'], files: ['electron/main/rtk/remove.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    ] });
    assert.deepEqual(testScope.scopeGaps(dir2, JSON.parse(fs.readFileSync(path.join(dir2, '.oxe', 'PLAN.json'), 'utf8'))), {});
  });

  it('execute: the frozen test that needs an out-of-scope file fails once with scope_insufficient and an output tail', async () => {
    const verify = 'node -e "console.error(\'FAIL tests/acceptance/f2/r4-removal.test.js > its IPC channel groups are gone\'); console.error(\'AssertionError: expected [ \\\'rtk\\\' ] to deeply equal []\'); process.exit(1)"';
    const dir = project({ tasks: [{ id: 'T8', title: 'R4', wave: 1, files: ['electron/main/rtk/remove.ts'], acceptance: ['A1'], verify: { commands: [verify] } }] });
    let calls = 0;
    const executor = { async execute() { calls += 1; fs.writeFileSync(path.join(dir, 'electron', 'main', 'rtk', 'remove.ts'), 'export {};\n'); return { success: true, failure_class: null, evidence: [], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, maxRetries: 2 });
    assert.equal(calls, 1, 'no retry of a task that cannot pass');
    const events = op.readEvents(dir, null);
    const si = events.find((e) => e.type === 'ScopeInsufficient');
    assert.ok(si, 'ScopeInsufficient emitted');
    assert.equal(si.payload.reason, 'frozen_test_needs_out_of_scope_file');
    assert.ok(si.payload.files.includes('shared/types/ipc.ts'));
    assert.match(si.payload.output_tail, /expected \[ 'rtk' \] to deeply equal/);
    const blocked = events.find((e) => e.type === 'WorkItemBlocked' && e.work_item_id === 'T8');
    assert.equal(blocked.payload.failure_class, 'scope_insufficient');
    const vc = events.find((e) => e.type === 'VerificationCompleted' && e.payload.failed_segment);
    assert.match(vc.payload.failed_segment.output_tail, /AssertionError/, 'failed_segment carries the output tail');
  });

  it('the agent saying the change is out of scope stops after attempt 1 too', async () => {
    const dir = project({ tasks: [{ id: 'T9', title: 'x', wave: 1, files: ['src/x.js'], verify: { commands: ['node -e 0'] } }], files: { 'src/x.js': 'x\n' } });
    let calls = 0;
    const executor = { async execute() { calls += 1; return { success: false, failure_class: 'llm', evidence: [], output: 'finish_task: the fix needs shared/types/ipc.ts, which is outside the task\'s files' }; } };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, maxRetries: 2 });
    assert.equal(calls, 1);
    const si = op.readEvents(dir, null).find((e) => e.type === 'ScopeInsufficient');
    assert.equal(si.payload.reason, 'agent_reported_out_of_scope');
  });
});
