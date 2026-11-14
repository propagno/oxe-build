'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const prdLib = require('../bin/lib/oxe-prd.cjs');
const rfcLib = require('../bin/lib/oxe-rfc.cjs');

// 1.21.2 — PRD above the SPEC (stories ↔ criteria), RFC before the plan of a risky phase (accept → ADR), and the
// documents published into docs/ with the phase commit.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

const SPEC = [
  '# SPEC', '', '## Objetivo', '', 'x', '', '## Critérios de aceite', '',
  '| ID | Critério | Como verificar | Risco |', '|---|---|---|---|',
  '| A1 | envia | `node -e 0` | P1 |', '| A2 | status | `node -e 0` | P3 |', '| A3 | log | `node -e 0` | P3 |', '',
  '## Requisitos', '', '| R-ID | Requisito | Versão |', '|---|---|---|', '| R1 | envio | v1 |', '| R2 | status | v1 |', '',
].join('\n');

const PRD = (rows) => [
  '---', 'oxe_doc: prd', 'version: 2', '---', '', '# PRD — Celular', '',
  '## Objetivos e métricas de sucesso', '', '| ID | Objetivo | Métrica | Meta | Como medir |', '|---|---|---|---|---|', '| M-1 | rápido | p95 | < 2 s | telemetria |', '| M-2 | adoção | uso | (meta) | x |', '',
  '## Histórias de usuário', '', '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |', '|----|------|-------|------|------------|-----------|------------|', ...rows, '',
].join('\n');

function project(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pd-'));
  dirs.push(dir);
  write(dir, '.oxe/SPEC.md', SPEC);
  write(dir, '.oxe/STATE.md', '# S\n');
  for (const [rel, c] of Object.entries(files)) write(dir, rel, c);
  return dir;
}

describe('PRD', () => {
  it('parses stories, metrics and version', () => {
    const p = prdLib.parsePrd(PRD(['| US-1 | operador | enviar | ganhar tempo | R1 | A1, A2 | Must |']));
    assert.equal(p.version, 2);
    assert.deepEqual(p.stories[0], { id: 'US-1', persona: 'operador', want: 'enviar', benefit: 'ganhar tempo', requirements: ['R1'], criteria: ['A1', 'A2'], priority: 'Must', cards: [] });
    assert.deepEqual(prdLib.parsePrd(PRD(['| US-2 | operador | ver (OXE-48) | saber | R1 | A1 | Must |'])).stories[0].cards, ['OXE-48'], 'the ALM key of the row; never US-/R-/A- ids');
    assert.equal(prdLib.storySentence(p.stories[0]), 'Como operador, quero enviar, para ganhar tempo.');
    assert.equal(p.metrics.length, 2);
  });

  it('lint: story without criterion, unknown A*/R*, criteria with no story, placeholders, metric without target', () => {
    const p = prdLib.parsePrd(PRD([
      '| US-1 | operador | enviar | ganhar tempo | R1 | A1, A9 | Must |',
      '| US-2 | (persona) | ver | saber | R7 | | Should |',
    ]));
    const r = prdLib.lintPrd(p, { criteria: ['A1', 'A2', 'A3'], requirements: ['R1', 'R2'] });
    const all = r.warnings.join('\n');
    for (const re of [/US-1: cita A9, que não existe/, /US-2: história incompleta/, /US-2: não aponta para nenhum critério/, /US-2: cita R7/, /critérios da SPEC sem história de usuário no PRD: A2, A3/, /M-2: métrica sem meta/]) assert.match(all, re);
    assert.equal(r.errors.length, 0, 'advisory by default');
    assert.ok(prdLib.lintPrd(p, { criteria: ['A1'], requirements: ['R1'], required: true }).errors.length > 0, 'prd.required → errors');
    assert.deepEqual(prdLib.lintPrd(null, {}), { errors: [], warnings: [] }, 'no PRD, not required → silent');
  });

  it('oxe-cc prd lint (CLI) and plan lint carry the PRD findings', () => {
    const dir = project({ '.oxe/PRD.md': PRD(['| US-1 | operador | enviar | ganhar tempo | R1 | A1 | Must |']) });
    const r = spawnSync(process.execPath, [CLI, 'prd', 'lint', '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(r.stdout, /1 história\(s\), 2 métrica\(s\)/);
    assert.match(r.stdout, /critérios da SPEC sem história de usuário no PRD: A2, A3/);
    assert.equal(r.status, 0, 'warnings do not fail');
    write(dir, '.oxe/config.json', JSON.stringify({ prd: { required: true } }));
    assert.notEqual(spawnSync(process.execPath, [CLI, 'prd', 'lint', '--dir', dir], { encoding: 'utf8' }).status, 0);
  });
});

describe('RFC', () => {
  const fill = (file, { open = true } = {}) => {
    let t = fs.readFileSync(file, 'utf8');
    t = t.replace('(O problema técnico, ligado às histórias e critérios: US-n, R*, A*.)', 'A rede do celular cai (US-1, A1).')
      .replace('(Desenho escolhido: componentes, contratos, dados, fluxo. Diagrama se ajudar.)', 'Fila local com retry exponencial.')
      .replace('- **(alternativa)** — (por que foi recusada)', '- **Enviar direto sem fila** — perde mensagens quando cai a rede')
      .replace('- (risco) → (mitigação)', '- mensagens fora de ordem → número de sequência');
    if (!open) t = t.replace('- (nenhuma — apague esta linha quando não houver)', '');
    else t = t.replace('- (nenhuma — apague esta linha quando não houver)', '- qual o tamanho máximo da fila?');
    fs.writeFileSync(file, t);
  };

  it('new → accept refuses open questions → accept records the decision (ADR) with the alternatives', () => {
    const dir = project();
    const created = op.runtimeRfc(dir, null, { action: 'new', title: 'Fila de envio offline', phase: 'F1', by: 'tech lead' });
    assert.equal(created.id, 'RFC-F1-1');
    assert.match(created.file, /^\.oxe\/rfc\/RFC-F1-1-fila-de-envio-offline\.md$/);
    fill(path.join(dir, created.file));
    assert.throws(() => op.runtimeRfc(dir, null, { action: 'accept', id: 'RFC-F1-1' }), /pergunta\(s\) em aberto: qual o tamanho máximo da fila\?/);
    fill(path.join(dir, created.file), { open: false });
    let t = read(dir, created.file).replace('- qual o tamanho máximo da fila?', '');
    fs.writeFileSync(path.join(dir, created.file), t);
    const acc = op.runtimeRfc(dir, null, { action: 'accept', id: 'RFC-F1-1', by: 'tech lead' });
    assert.equal(acc.decision, 'D-F1-1');
    t = read(dir, created.file);
    assert.match(t, /\*\*Status:\*\* aceito/);
    assert.match(t, /\*\*Decisão:\*\* D-F1-1/);
    const adr = fs.readdirSync(path.join(dir, 'docs', 'adr')).find((f) => f.startsWith('D-F1-1'));
    const adrText = read(dir, `docs/adr/${adr}`);
    assert.match(adrText, /## Contexto\n\nA rede do celular cai \(US-1, A1\)\./);
    assert.match(adrText, /\*\*Enviar direto sem fila\*\* — recusada: perde mensagens quando cai a rede/);
    assert.match(adrText, /\*\*Origem:\*\* RFC-F1-1/);
    // the Motivação's US-1 / A1 became the decision's anchors (they were text only)
    assert.match(adrText, /\*\*Critérios:\*\* A1/);
    assert.match(adrText, /\*\*Histórias:\*\* US-1/);
    assert.throws(() => op.runtimeRfc(dir, null, { action: 'accept', id: 'RFC-F1-1' }), /já está aceito/);
    const list = op.runtimeRfc(dir, null, { action: 'list' }).rfcs;
    assert.equal(list[0].status, 'accepted');
  });

  it('phase gate: a P0/P1 criterion needs an accepted RFC — warning by default, error with rfc.required "risk"; "never" off', () => {
    const dir = project();
    const risks = require('../bin/lib/oxe-risk-decision.cjs').criterionRisks(SPEC);
    const ctx = (mode) => ({ phase: 'F1', phaseCriteria: ['A1', 'A2'], risks, mode });
    let r = rfcLib.lintPhaseRfc(dir, ctx('advisory'));
    assert.match(r.warnings[0], /fase F1 sem RFC aceito \(critério\(s\) de risco A1 \(P1\)\)/);
    assert.equal(rfcLib.lintPhaseRfc(dir, ctx('risk')).errors.length, 1);
    assert.deepEqual(rfcLib.lintPhaseRfc(dir, ctx('never')), { errors: [], warnings: [] });
    assert.deepEqual(rfcLib.lintPhaseRfc(dir, { ...ctx('advisory'), phaseCriteria: ['A2', 'A3'] }), { errors: [], warnings: [] }, 'P3 only → no RFC needed');
    assert.equal(rfcLib.lintPhaseRfc(dir, { ...ctx('always'), phaseCriteria: ['A2'] }).errors.length, 1);
    const created = op.runtimeRfc(dir, null, { action: 'new', title: 'Fila', phase: 'F1' });
    assert.match(rfcLib.lintPhaseRfc(dir, ctx('advisory')).warnings[0], /aceite RFC-F1-1 com oxe-cc rfc accept RFC-F1-1/);
    assert.ok(created);
    assert.equal(rfcLib.rfcMode({ rfc: { required: true } }), 'risk');
    assert.equal(rfcLib.rfcMode({ rfc: false }), 'never');
    assert.equal(rfcLib.rfcMode({}), 'advisory');
  });

  it('reject needs a reason', () => {
    const dir = project();
    op.runtimeRfc(dir, null, { action: 'new', title: 'Trocar o banco', phase: 'F2' });
    assert.throws(() => op.runtimeRfc(dir, null, { action: 'reject', id: 'RFC-F2-1' }), /motivo/);
    op.runtimeRfc(dir, null, { action: 'reject', id: 'RFC-F2-1', reason: 'custo de migração alto demais' });
    assert.equal(op.runtimeRfc(dir, null, { action: 'list' }).rfcs[0].status, 'rejected');
  });
});

describe('docs publish', () => {
  it('PRD (+ ALM keys), RFCs with index, ADRs and SYSTEM-DESIGN into docs/; idempotent; never inside .oxe/', () => {
    const dir = project({ '.oxe/PRD.md': PRD(['| US-1 | operador | enviar | ganhar tempo | R1 | A1 | Must |']), '.oxe/SYSTEM-DESIGN.md': '# SYSTEM-DESIGN\n' });
    require('../bin/lib/oxe-alm.cjs').addLink(path.join(dir, '.oxe', 'program'), { ref: 'US-1', key: 'OXE-30', url: 'https://x/browse/OXE-30' });
    op.runtimeRfc(dir, null, { action: 'new', title: 'Fila', phase: 'F1' });
    op.runtimeDecision(dir, null, { action: 'add', title: 'Usar fila local', phase: 'F1' });
    const out = op.runtimeDocsPublish(dir, null, {});
    for (const f of ['docs/product/PRD.md', 'docs/rfc/RFC-F1-1-fila.md', 'docs/rfc/README.md', 'docs/architecture/SYSTEM-DESIGN.md']) assert.ok(out.written.includes(f) || fs.existsSync(path.join(dir, f)), f);
    assert.match(read(dir, 'docs/product/PRD.md'), /\| US-1 \| \[OXE-30\]\(https:\/\/x\/browse\/OXE-30\) \|/);
    assert.match(read(dir, 'docs/rfc/README.md'), /\| \[RFC-F1-1\]\(RFC-F1-1-fila\.md\) \| Fila \| F1 \| rascunho \|/);
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'adr', 'README.md')));
    const again = op.runtimeDocsPublish(dir, null, {});
    assert.equal(again.written.length, 0, 'nothing changed → nothing rewritten');
    assert.throws(() => op.runtimeDocsPublish(dir, null, { dir: '.oxe/docs' }), /dentro de \.oxe/);
    write(dir, '.oxe/config.json', JSON.stringify({ docs_publish: false }));
    assert.equal(op.runtimeDocsPublish(dir, null, {}).disabled, true);
  });
});
