'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 - OXB-121 (contradiction, P0): after F1's close the oxespace STATE.md said "status: completed, checks 38/38"
// in one block and "Status da run: failed, Concluidos (0), Falhos (7)" in the other, for the same run.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const RUNTIME_BLOCK = [
  '# Estado',
  '',
  '## Fase atual',
  '',
  '- **Status da run:** failed',
  '- **Run ID:** oxe-run-x',
  '',
  '## Runtime operacional',
  '',
  '- **runtime_status:** failed',
  '',
  '## Progresso',
  '',
  '- **Concluídos (0):** —',
  '- **Falhos (3):** T1, T2, T3',
  '- **Bloqueados (0):** —',
].join('\n');

describe('OXB-121: the STATE.md runtime block agrees with the run and with PLAN.json', () => {
  it('status from the run state; done tasks from PLAN.json are never listed as failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-state-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T1', title: 'a', wave: 1, files: ['a.js'], done: true },
      { id: 'T2', title: 'b', wave: 1, files: ['b.js'], done: true },
      { id: 'T3', title: 'c', wave: 1, files: ['c.js'] },
      { id: 'T4', title: 'd', wave: 1, files: [], kind: 'external_delivery', blocked_by: ['o/r#1'] },
    ] }));
    const out = op.coherentStateProjection(dir, null, RUNTIME_BLOCK, { status: 'completed' });
    assert.match(out, /- \*\*Status da run:\*\* completed/);
    assert.match(out, /- \*\*runtime_status:\*\* completed/);
    assert.match(out, /- \*\*Concluídos \(2\):\*\* T1, T2/);
    assert.match(out, /- \*\*Falhos \(1\):\*\* T3/);
    assert.match(out, /- \*\*Aguardando entrega externa \(1\):\*\* T4/);
    assert.doesNotMatch(out, /failed/);
  });
});

describe('OXB-157: status cross-checks the run against PLAN.json', () => {
  it('a task the run completed but a regenerated PLAN.json lost is reported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-state2-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# S\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{"external_dependency_check":false}');
    const plan = { schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] };
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan));
    require('child_process').spawnSync('git', ['init', '-q'], { cwd: dir });
    const executor = { async execute() { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1'); return { success: true, failure_class: null, evidence: ['src/a.js'], output: 'ok', completed_by: 'finish_task' }; } };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    assert.deepEqual(op.runtimePhaseWork(dir, null).run_done_not_in_plan, []);
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan)); // regenerated: done dropped
    assert.deepEqual(op.runtimePhaseWork(dir, null).run_done_not_in_plan, ['T1']);
  });
});
