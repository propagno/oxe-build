'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const specEdit = require('../bin/lib/oxe-spec-edit.cjs');
const coverage = require('../bin/lib/oxe-criterion-coverage.cjs');

// 1.21.2 — three defects found while planning F2 of a real program (with Jira keys in every criterion):
// 1. `spec add criterion` wrote by position: in | ID | Critério | Risco | Como verificar | the verify went under Risco.
// 2. a phase in `planning` (only `program start` ran) refused a new criterion as if it had started.
// 3. OXB-030 took the "104" of "(OXE-104)" for a status code the acceptance test had to exercise.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC4 = [
  '# SPEC', '', '## Critérios de aceite', '',
  '| ID | Critério | Risco | Como verificar |',
  '|----|----------|-------|----------------|',
  '| A1 | envia o texto (OXE-101) | P1 | vitest send |',
  '| A2 | mostra o status (OXE-102) | P2 | vitest status |', '',
].join('\n');

describe('spec add criterion: by the header columns', () => {
  it('4 columns: --risk goes under Risco and the verify under Como verificar', () => {
    const out = specEdit.addCriterion(SPEC4, 'A3', { text: 'reenvia (OXE-104)', verify: 'vitest resend', risk: 'P1' });
    assert.equal(out.after, '| A3 | reenvia (OXE-104) | P1 | vitest resend |');
    assert.match(out.text, /\| A2 \|.*\n\| A3 \| reenvia/);
  });

  it('4 columns without --risk: refused, nothing written', () => {
    assert.throws(() => specEdit.addCriterion(SPEC4, 'A3', { text: 'x', verify: 'y' }), /coluna Risco: informe --risk/);
  });

  it('a column the command cannot fill: refused, naming it', () => {
    const spec = SPEC4.replace('| ID | Critério | Risco | Como verificar |', '| ID | Critério | Risco | Como verificar | Dono |').replace('|----|----------|-------|----------------|', '|----|----------|-------|----------------|------|');
    assert.throws(() => specEdit.addCriterion(spec, 'A3', { text: 'x', verify: 'y', risk: 'P1' }), /não preenche: Dono/);
  });

  it('3 columns (older SPECs) still work; --risk there is refused', () => {
    const spec3 = '| ID | Critério | Como verificar |\n|----|----------|----------------|\n| A1 | a | b |\n';
    assert.equal(specEdit.addCriterion(spec3, 'A2', { text: 'c', verify: 'd' }).after, '| A2 | c | d |');
    assert.throws(() => specEdit.addCriterion(spec3, 'A2', { text: 'c', verify: 'd', risk: 'P1' }), /não tem coluna "Risco"/);
  });

  it('amend --verify / --risk hit their own columns too', () => {
    const v = specEdit.amendCriterion(SPEC4, 'A1', { verify: 'vitest send --run' });
    assert.equal(v.after, '| A1 | envia o texto (OXE-101) | P1 | vitest send --run |');
    assert.equal(specEdit.amendCriterion(SPEC4, 'A2', { risk: 'P0' }).after, '| A2 | mostra o status (OXE-102) | P0 | vitest status |');
  });
});

describe('program phase edit: a phase in planning still takes criteria', () => {
  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-f2fix-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC4.replace('| A2 |', '| A3 | reenvia (OXE-104) | P1 | v |\n| A2 |'));
    fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), '# Roteiro\n\n## Fase 1 — Base\n\n**Requisitos:** —\n**Critérios de aceite:** A1\n**Escopo:** base\n\n## Fase 2 — Envio\n\n**Requisitos:** —\n**Critérios de aceite:** A2\n**Escopo:** envio\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
    const ph = (id, extra) => ({ id, title: id, requirements: [], acceptance: [], scope: null, status: 'pending', plan_ref: null, run_id: null, started_at: null, closed_at: null, ...extra });
    fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({
      schema_version: 1, roadmap_ref: '.oxe/ROADMAP.md', active_phase: 'F2', created_at: 'x', updated_at: 'x',
      phases: [ph('F1', { acceptance: ['A1'], status: 'closed' }), ph('F2', { acceptance: ['A2'], status: 'planning', started_at: new Date(Date.now() - 60_000).toISOString() })],
    }, null, 2));
    return dir;
  }

  it('planning and no attempt ran (only program start) → the criterion goes in', () => {
    const dir = project();
    const out = op.runtimeProgramPhaseEdit(dir, null, { phase: 'F2', addAcceptance: 'A3', by: 'tl' });
    assert.deepEqual(out.after.acceptance, ['A2', 'A3']);
  });

  it('planning with a plan → goes in, with the warning to cover it and re-lint', () => {
    const dir = project();
    const file = path.join(dir, '.oxe', 'program', 'PROGRAM.json');
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    st.phases[1].plan_ref = '.oxe/PLAN.md';
    fs.writeFileSync(file, JSON.stringify(st));
    const out = op.runtimeProgramPhaseEdit(dir, null, { phase: 'F2', addAcceptance: 'A3', by: 'tl' });
    assert.ok(out.warnings.some((w) => /cubra A3 no PLAN e rode oxe-cc plan lint/.test(w)));
  });

  it('planning but a task already started → refused (CR path)', () => {
    const dir = project();
    op.appendEvent(dir, null, { type: 'TaskStarted', work_item_id: 'T1' });
    assert.throws(() => op.runtimeProgramPhaseEdit(dir, null, { phase: 'F2', addAcceptance: 'A3', by: 'tl' }), /F2 já começou \(planning\).*via CR/);
  });
});

describe('OXB-030: ALM item keys are not verifiable terms', () => {
  it('"(OXE-104)", CODE-8 and AB#123 are ignored; a real status code still counts', () => {
    assert.deepEqual(coverage.verifiableTerms('reenvia após falha (OXE-104)'), []);
    assert.deepEqual(coverage.verifiableTerms('ver CODE-8 e AB#123, e `OXE-12`'), []);
    assert.deepEqual(coverage.verifiableTerms('responde 404 quando não existe (OXE-104)'), ['404']);
  });
});
