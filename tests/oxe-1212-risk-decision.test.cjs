'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const rd = require('../bin/lib/oxe-risk-decision.cjs');

// 1.21.2 — OXB-140: risk priority per criterion and PASS / CONCERNS / FAIL for the phase.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const SPEC = '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar | Risco |\n|---|---|---|---|\n| A1 | upgrade com dados | teste | P0 |\n| A2 | borda cosmética | teste | P2 |\n| A3 | sem risco declarado | teste | |\n';
const program = { phases: [{ id: 'F1', acceptance: ['A1', 'A2'] }, { id: 'F2', acceptance: [] }, { id: 'F3', acceptance: [] }] };
const doc = (frozen) => ({ tasks: [{ id: 'T1', acceptance: ['A1', 'A2'] }], acceptance_tests: frozen.map((c) => ({ criterion: c, files: ['t.js'], command: 'x' })) });

describe('OXB-140: risk decision', () => {
  it('reads the risk column and [Pn] tags', () => {
    const r = rd.criterionRisks(SPEC + '| A4 | algo [P1] | t | |\n');
    assert.deepEqual([...r], [['A1', 'P0'], ['A2', 'P2'], ['A4', 'P1']]);
  });

  it('PASS when all full; CONCERNS with a P2 partial and a waiver; without the waiver it does not close', () => {
    const base = { phase: program.phases[0], program, specText: SPEC, verifyCompleted: true, signoffs: [], config: {} };
    assert.equal(rd.decide({ ...base, doc: doc(['A1', 'A2']), waivers: [] }).decision, 'PASS');
    const noWaiver = rd.decide({ ...base, doc: doc(['A1']), waivers: [] });
    assert.equal(noWaiver.decision, 'FAIL');
    assert.match(noWaiver.reasons[0], /A2 \(P2\) com cobertura partial sem waiver/);
    const withWaiver = rd.decide({ ...base, doc: doc(['A1']), waivers: [{ kind: 'waiver', criterion: 'A2', by: 'po', reason: 'cosmético, fica para F3', until: 'F3' }] });
    assert.equal(withWaiver.decision, 'CONCERNS');
  });

  it('a P0 partial is FAIL even with a waiver; a waiver past its phase no longer counts', () => {
    const base = { phase: program.phases[0], program, specText: SPEC, verifyCompleted: true, signoffs: [], config: {} };
    const p0 = rd.decide({ ...base, doc: doc(['A2']), waivers: [{ kind: 'waiver', criterion: 'A1', by: 'po', reason: 'x'.repeat(10), until: 'F3' }] });
    assert.equal(p0.decision, 'FAIL');
    assert.match(p0.reasons[0], /A1 \(P0\).*waiver não vale/);
    const expired = rd.decide({ ...base, phase: { id: 'F3', acceptance: ['A2'] }, doc: doc([]), waivers: [{ kind: 'waiver', criterion: 'A2', by: 'po', reason: 'x'.repeat(10), until: 'F3' }] });
    assert.equal(expired.decision, 'FAIL');
    assert.match(expired.reasons[0], /o waiver venceu nesta fase/);
  });

  it('a criterion without a priority inherits the project default and warns', () => {
    const out = rd.decide({ phase: { id: 'F1', acceptance: ['A3'] }, program, specText: SPEC, doc: doc([]), verifyCompleted: true, signoffs: [{ criteria: ['A3'], evidence: 'r.md' }], waivers: [], config: { program: { default_risk: 'P1' } } });
    assert.equal(out.rows[0].risk, 'P1');
    assert.match(out.warnings[0], /A3: sem prioridade de risco — herdou P1/);
    assert.equal(out.decision, 'PASS', 'a fresh sign-off with evidence is full coverage');
  });

  it('runtime waive records owner, reason and the phase it comes back', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rd-'));
    dirs.push(d);
    fs.mkdirSync(path.join(d, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(path.join(d, '.oxe', 'STATE.md'), '# S\n');
    const bad = spawnSync(process.execPath, [CLI, 'runtime', 'waive', '--criteria', 'A2', '--by', 'po', '--reason', 'cosmético fica', '--dir', d], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'waive', '--criteria', 'A2', '--by', 'po', '--reason', 'cosmético, fica para F3', '--until', 'F3', '--dir', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(rd.listWaivers(path.join(d, '.oxe', 'program'))[0].until, 'F3');
  });
});
