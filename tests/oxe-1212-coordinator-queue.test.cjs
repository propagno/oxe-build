'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const cq = require('../bin/lib/oxe-coordinator-queue.cjs');

// 1.21.2 — OXB-103: coordinator mode — the next prep item of each role from the PROGRAM DAG.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

describe('OXB-103: coordinator queue', () => {
  it('ready phases follow the DAG; open CRs go to the roles of their tasks; frozen tests of the next phase go to the test role', () => {
    const program = { active_phase: 'F2', phases: [
      { id: 'F1', status: 'closed', acceptance: ['A1'] },
      { id: 'F2', status: 'executing', acceptance: ['A2'] },
      { id: 'F3', status: 'pending', acceptance: ['A3', 'A4'], depends_on: ['F1'] },
      { id: 'F4', status: 'pending', acceptance: ['A5'], depends_on: ['F3'] },
    ] };
    assert.deepEqual(cq.readyPhases(program).map((p) => p.id), ['F3']);
    const q = cq.build({
      program,
      doc: { tasks: [{ id: 'T1', title: 'fila', wave: 1, roles: ['backend'], acceptance: ['A2'] }, { id: 'T2', title: 'tela', wave: 1, roles: ['frontend'], acceptance: ['A2'], done: true }], acceptance_tests: [{ criterion: 'A3', files: ['t.js'], command: 'x' }] },
      changes: [{ id: 'CR-3', status: 'open', class: 'defect', severity: 'high', tasks: ['T1'], summary: 'fila perde item' }, { id: 'CR-4', status: 'resolved', class: 'defect', tasks: ['T1'] }],
      config: { program: { roles: { tests: 'qa-mobile' } } },
    });
    assert.equal(q.next.backend.ref, 'CR-3', 'the open CR comes before the task');
    assert.deepEqual(q.roles.backend.map((x) => x.ref), ['CR-3', 'T1']);
    assert.ok(!q.roles.frontend, 'done task, no CR: nothing for frontend');
    assert.deepEqual(q.roles['qa-mobile'].map((x) => x.ref), ['A4'], 'A3 already frozen; F4 not ready');
    assert.equal(q.next['tech lead'].kind, 'plan');
  });

  it('program queue writes QUEUE.md and queue.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-cq-'));
    dirs.push(dir);
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n');
    write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Depois\n\n**Critérios de aceite:** A2\n');
    write(dir, '.oxe/config.json', '{}');
    op.runtimeProgramInit(dir, null, {});
    op.runtimeProgramStart(dir, null, 'F1');
    const r = spawnSync(process.execPath, [CLI, 'program', 'queue', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const md = fs.readFileSync(path.join(dir, '.oxe', 'program', 'QUEUE.md'), 'utf8');
    assert.match(md, /## qa[\s\S]*escrever o teste congelado de A2 \(F2\)/);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'program', 'queue.json'), 'utf8')).roles.qa);
  });
});
