'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const { checkSpec } = require('../bin/lib/oxe-spec-check.cjs');

// 1.21.2 — `spec check` (the upstream quality gate) and `spec approve` (only over a green check, recorded).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const SPEC = [
  '# SPEC', '', '## Requisitos', '',
  '| R-ID | Requisito | Versão | Critério de aceite |', '|---|---|---|---|',
  '| R1 | enviar pedido | v1 | A1, A2 |', '| R2 | relatório | v2 | — |', '',
  '## Critérios de aceite', '',
  '| ID | Critério | Risco | Como verificar |', '|---|---|---|---|',
  '| A1 | o Pedido é salvo | P2 | vitest pedido |', '| A2 | erro 409 em duplicata | P1 | vitest dup |', '',
  '## Suposições', '', '- SLA a confirmar', '',
].join('\n');
const ROADMAP = '# Roteiro\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A2\n';
const PRD = [
  '---', 'oxe_doc: prd', 'version: 1', '---', '', '# PRD — Pedidos', '', '## Histórias de usuário', '',
  '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |', '|---|---|---|---|---|---|---|',
  '| US-1 | cliente | salvar o pedido | não perder a compra | R1 | A1, A2 | Must |', '',
].join('\n');

describe('spec check: pure rules', () => {
  const base = { specText: SPEC, roadmapText: ROADMAP, fast: true, rfcs: [{ id: 'RFC-1', status: 'draft' }] };
  it('a clean spec passes', () => {
    const r = checkSpec(base);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.summary.risky, ['A2']);
  });

  it('v1 requirement without criterion, citing a missing one, criterion without verify or risk → errors', () => {
    const bad = SPEC.replace('| R1 | enviar pedido | v1 | A1, A2 |', '| R1 | enviar pedido | v1 | A1, A9 |\n| R3 | exportar | v1 | — |').replace('| P1 | vitest dup |', '| PX |  |');
    const r = checkSpec({ ...base, specText: bad });
    assert.ok(r.errors.some((e) => /R1: cita A9/.test(e)));
    assert.ok(r.errors.some((e) => /R3 \(v1\): não aponta/.test(e)));
    assert.ok(r.errors.some((e) => /A2: sem "Como verificar"/.test(e)));
    assert.ok(r.errors.some((e) => /A2: risco "PX" inválido/.test(e)));
  });

  it('P0/P1 without any RFC: warning by default, error with rfc.required risk', () => {
    assert.ok(checkSpec({ ...base, rfcs: [] }).warnings.some((w) => /A2 sem RFC/.test(w)));
    assert.ok(checkSpec({ ...base, rfcs: [], rfcMode: 'risk' }).errors.some((e) => /A2 sem RFC/.test(e)));
  });

  it('glossary: a forbidden synonym in SPEC/PRD is flagged (whole word, accents)', () => {
    const r = checkSpec({ ...base, specText: SPEC.replace('o Pedido é salvo', 'a ordem é salva'), glossary: [{ term: 'Pedido', synonyms: ['ordem'] }] });
    assert.ok(r.warnings.some((w) => /"ordem" é sinônimo proibido de "Pedido"/.test(w)));
    assert.ok(!checkSpec({ ...base, specText: SPEC.replace('o Pedido é salvo', 'ordenação estável'), glossary: [{ term: 'Pedido', synonyms: ['ordem'] }] }).warnings.some((w) => /sinônimo/.test(w)));
  });

  it('grill: absent without --fast, open, or with decisions missing from the ledger → errors', () => {
    assert.ok(checkSpec({ ...base, fast: false }).errors.some((e) => /grill não feito/.test(e)));
    assert.ok(checkSpec({ ...base, fast: false, grill: { started: true, closed: null, blockers: ['x'] } }).errors.some((e) => /grill aberto/.test(e)));
    const closed = { started: true, closed: { at: 'x' }, decisions: [{ id: 'Q-3' }], assumptions: [] };
    assert.ok(checkSpec({ ...base, fast: false, grill: closed }).errors.some((e) => /Q-3 — oxe-cc grill export/.test(e)));
    assert.deepEqual(checkSpec({ ...base, fast: false, grill: closed, decisionSources: ['grill:Q-3'] }).errors, []);
    const deferred = { ...closed, assumptions: [{ id: 'Q-4' }] };
    assert.ok(checkSpec({ ...base, fast: false, grill: deferred, decisionSources: ['grill:Q-3'], specText: SPEC.replace(/## Suposições[\s\S]*/, '') }).errors.some((e) => /adiou Q-4/.test(e)));
  });

  it('ROADMAP missing a criterion → warning; no ROADMAP → error', () => {
    assert.ok(checkSpec({ ...base, roadmapText: '# Roteiro\n\n**Critérios de aceite:** A1\n' }).warnings.some((w) => /fora de todas as fases do ROADMAP: A2/.test(w)));
    assert.ok(checkSpec({ ...base, roadmapText: '' }).errors.some((e) => /ROADMAP.md ausente/.test(e)));
  });
});

describe('spec check / approve on a project', () => {
  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-specchk-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), SPEC);
    fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), ROADMAP);
    fs.writeFileSync(path.join(dir, '.oxe', 'PRD.md'), PRD);
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ adr: false }));
    return dir;
  }

  it('approve refuses a red check; with --fast and a green check it records the approval and its hash', () => {
    const dir = project();
    assert.throws(() => op.runtimeSpecApprove(dir, null, { by: 'po' }), /grill não feito/);
    assert.throws(() => op.runtimeSpecApprove(dir, null, { fast: true }), /--by/);
    const out = op.runtimeSpecApprove(dir, null, { by: 'po', fast: true });
    assert.equal(out.approved, true);
    const a = op.specApproval(dir, null);
    assert.equal(a.by, 'po');
    assert.equal(a.changed_since, false);
    fs.appendFileSync(path.join(dir, '.oxe', 'SPEC.md'), '\n| A3 | novo | P3 | manual |\n');
    assert.equal(op.specApproval(dir, null).changed_since, true, 'a later edit is visible to the next step');
    const changes = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8');
    assert.match(changes, /"kind":"spec_approval"/);
  });

  it('with a closed grill the check needs no --fast', () => {
    const dir = project();
    const g = (action, o = {}) => op.runtimeGrill(dir, null, { action, ...o });
    g('start', { type: 'investigação' });
    for (const b of ['problem', 'scope', 'risks']) {
      const q = g('ask', { branch: b, question: `pergunta ${b}?`, recommended: 'sim' });
      g('answer', { id: q.id, choice: 'ok' });
      g('confirm', { branch: b });
    }
    g('close');
    const r = op.runtimeSpecCheck(dir, null, {});
    assert.deepEqual(r.errors, []);
    assert.equal(r.summary.grill, 'fechado');
  });
});
