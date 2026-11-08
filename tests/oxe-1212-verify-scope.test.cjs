'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-069: with F1 active, the phase verify listed "Como verificar não é executável" gaps for 38 criteria
// of F2–F9 (no plan yet) and counted them in the coverage.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = `# SPEC

## Objetivo

x

## Critérios de aceite

| ID | Critério | Como verificar |
|---|---|---|
| A1 | a base funciona | \`node -e "process.exit(0)"\` |
| A2 | o celular pareia | teste manual no aparelho |
| A3 | o instalador sobe | teste manual na VM |
| A4 | o update funciona | teste manual |
`;

function project({ phases, active = 'F1' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-vs-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC);
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'base', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e "process.exit(0)"'] } }] }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  const mk = (id, acceptance) => ({ id, title: id, requirements: [], acceptance, scope: null, status: id === active ? 'executing' : 'pending', plan_ref: null, run_id: null, started_at: null, closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: active, created_at: 'x', updated_at: 'x', phases: phases.map(([id, acc]) => mk(id, acc)) }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const writer = (dir) => ({
  async execute() {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'module.exports = 1;\n');
    return { success: true, failure_class: null, evidence: ['src/a.js'], output: 'ok', completed_by: 'finish_task' };
  },
});

describe('OXB-069: the phase verify checks only the active phase criteria', () => {
  it('F1 active: no gaps for F2–F4 criteria, one "not planned yet" line, and the suite has only A1', async () => {
    const dir = project({ phases: [['F1', ['A1']], ['F2', ['A2']], ['F3', ['A3']], ['F4', ['A4']]] });
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    const out = await op.runRuntimeVerify(dir, null, { timeoutMs: 60_000, gates: false });
    const gaps = out.report ? out.report.gaps : out.gaps || (op.readRunState(dir, null).verification_gaps);
    const text = (gaps || []).join('\n');
    assert.doesNotMatch(text, /Critério A[234]/);
    assert.match(text, /Fora da fase F1: 3 critério\(s\) de F2–F4 ainda não planejados/);
    const suite = op.readRunState(dir, null).verification_suite;
    const refs = new Set((suite.checks || []).map((c) => c.acceptance_ref).filter(Boolean));
    assert.ok(!refs.has('A2') && !refs.has('A3') && !refs.has('A4'), [...refs].join(','));
  });

  it('without a program nothing changes (every SPEC criterion is checked)', async () => {
    const dir = project({ phases: [['F1', ['A1']]] });
    fs.rmSync(path.join(dir, '.oxe', 'program'), { recursive: true, force: true });
    await op.runRuntimeExecute(dir, null, { executor: writer(dir), skipPreflight: true });
    await op.runRuntimeVerify(dir, null, { timeoutMs: 60_000, gates: false });
    const text = (op.readRunState(dir, null).verification_gaps || []).join('\n');
    assert.match(text, /Critério A2/);
    assert.doesNotMatch(text, /Fora da fase/);
  });
});
