'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const grill = require('../bin/lib/oxe-grill.cjs');

// 1.21.2 — the grill: the spec's discovery as a decision tree, one question at a time with the recommended answer,
// resumable, measured; close refuses while a blocking branch is open, unconfirmed or contradicted.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-grill-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ adr: false }));
  return dir;
}
const g = (dir, action, o = {}) => op.runtimeGrill(dir, null, { action, ...o });

/** Walks every blocking branch of a bugfix with one decided question + playback. */
function answerAll(dir, type = 'bugfix') {
  for (const b of grill.BLOCKING_BY_TYPE[type]) {
    const q = g(dir, 'ask', { branch: b, question: `pergunta do ramo ${b}?`, options: 'opção alfa | opção beta', recommended: 'opção alfa', why: 'evidência', decision: b === 'scope' });
    g(dir, 'answer', { id: q.id, choice: 'ok' });
    g(dir, 'confirm', { branch: b });
  }
}

describe('grill: the tree', () => {
  it('demand type decides the blocking branches; dependencies order the next branch', () => {
    const dir = project();
    const s = g(dir, 'start', { type: 'bugfix' });
    assert.equal(s.type, 'bugfix');
    const blocking = s.grill.branches.filter((b) => b.blocking).map((b) => b.id);
    assert.deepEqual(blocking, ['problem', 'scope', 'flows', 'edges', 'rollout', 'risks']);
    assert.equal(s.grill.next_branch, 'problem');
    assert.throws(() => g(dir, 'confirm', { branch: 'scope' }), /nenhuma decisão|confirme antes/);
    assert.throws(() => g(dir, 'start', { type: 'xyz', restart: true }), /tipo "xyz" desconhecido/);
  });

  it('every question carries the recommended answer; "ok" takes it, a number picks an option, text is kept', () => {
    const dir = project();
    g(dir, 'start', { type: 'feature' });
    assert.throws(() => g(dir, 'ask', { branch: 'problem', question: 'qual o problema central?' }), /resposta recomendada/);
    const q1 = g(dir, 'ask', { branch: 'problem', question: 'qual o problema central?', options: 'lento | caro | confuso', recommended: 'lento', why: 'tickets de suporte' });
    assert.equal(q1.id, 'Q-1');
    assert.equal(g(dir, 'answer', { id: 'Q-1', choice: 'ok' }).decided_by, 'recommended');
    const q2 = g(dir, 'ask', { branch: 'problem', question: 'quem sente a dor primeiro?', options: 'operador | gestor', recommended: 'operador' });
    assert.equal(g(dir, 'answer', { id: q2.id, choice: '2' }).answer, 'gestor');
    const q3 = g(dir, 'ask', { branch: 'problem', question: 'qual o outcome observável?', recommended: 'p95 < 2s' });
    const a3 = g(dir, 'answer', { id: q3.id, text: 'p95 abaixo de 1,5 s no envio' });
    assert.equal(a3.answer, 'p95 abaixo de 1,5 s no envio');
    assert.equal(a3.decided_by, 'user');
  });

  it('a fact found in the code is recorded with its source, never asked', () => {
    const dir = project();
    g(dir, 'start', { type: 'bugfix' });
    assert.throws(() => g(dir, 'fact', { branch: 'flows', text: 'o envio usa fila' }), /cita a fonte/);
    const f = g(dir, 'fact', { branch: 'problem', text: 'o erro 500 vem do timeout do gateway', source: 'src/gw.ts:40' });
    const st = g(dir, 'status');
    assert.equal(st.branches.find((b) => b.id === 'problem').decided, 1);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'grill', 'GRILL.md'), 'utf8'), new RegExp(`${f.id}.*\\n.*fato do código; fonte: src/gw.ts:40`));
  });
});

describe('grill: changes, contradictions, deferrals', () => {
  it('changing an answer reopens the questions that depended on it and unconfirms the dependent branches', () => {
    const dir = project();
    g(dir, 'start', { type: 'bugfix' });
    const p = g(dir, 'ask', { branch: 'problem', question: 'o erro afeta todos os clientes?', recommended: 'sim' });
    g(dir, 'answer', { id: p.id, choice: 'ok' });
    g(dir, 'confirm', { branch: 'problem' });
    const s = g(dir, 'ask', { branch: 'scope', question: 'corrigimos para todos de uma vez?', recommended: 'sim', depends: p.id });
    g(dir, 'answer', { id: s.id, choice: 'ok' });
    g(dir, 'confirm', { branch: 'scope' });
    const changed = g(dir, 'answer', { id: p.id, text: 'não, só os do plano empresarial' });
    assert.deepEqual(changed.reopened, [s.id]);
    const st = g(dir, 'status');
    assert.equal(st.branches.find((b) => b.id === 'problem').confirmed, false);
    assert.equal(st.branches.find((b) => b.id === 'scope').confirmed, false, 'scope depends on problem');
    assert.ok(st.open_questions.some((q) => q.id === s.id && q.status === 'reopened'));
  });

  it('a contradiction blocks the close until one side is answered again (or resolved with a note)', () => {
    const dir = project();
    g(dir, 'start', { type: 'investigação' });
    answerAll(dir, 'investigação');
    const c = g(dir, 'conflict', { ids: 'Q-1,Q-2', note: 'escopo diz só leitura, problema pede correção' });
    assert.throws(() => g(dir, 'close'), /C-1: contradição/);
    g(dir, 'resolve', { id: c.id, note: 'vale só leitura; correção vira demanda nova' });
    g(dir, 'term', { none: true });
    assert.equal(g(dir, 'close').closed, true);
  });

  it('"não sei" becomes a deferral with a reason → an assumption, listed at the close', () => {
    const dir = project();
    g(dir, 'start', { type: 'investigação' });
    const q = g(dir, 'ask', { branch: 'risks', question: 'há SLA contratual?', recommended: 'não' });
    assert.throws(() => g(dir, 'defer', { id: q.id }), /motivo/);
    g(dir, 'defer', { id: q.id, reason: 'jurídico responde na semana que vem' });
    answerAll(dir, 'investigação');
    const out = g(dir, 'close');
    assert.deepEqual(out.assumptions.map((a) => a.id), [q.id]);
  });
});

describe('grill: close and the documents', () => {
  it('close refuses with the exact list of what is missing; a full walk closes', () => {
    const dir = project();
    g(dir, 'start', { type: 'feature' });
    let err = null;
    try { g(dir, 'close'); } catch (e) { err = e; }
    assert.ok(err && err.blockers.length >= 11);
    assert.ok(err.blockers.some((b) => /glossário vazio/.test(b)));
    answerAll(dir, 'feature');
    assert.throws(() => g(dir, 'close'), /glossário vazio/);
    g(dir, 'term', { term: 'Pedido', definition: 'conjunto de itens confirmados pelo cliente', synonyms: 'ordem | compra' });
    const out = g(dir, 'close', { by: 'po' });
    assert.equal(out.glossary, '.oxe/GLOSSARY.md');
    const gl = fs.readFileSync(path.join(dir, '.oxe', 'GLOSSARY.md'), 'utf8');
    assert.match(gl, /\| Pedido \| conjunto de itens confirmados pelo cliente \| ordem, compra \|/);
    assert.deepEqual(grill.readGlossary(path.join(dir, '.oxe', 'GLOSSARY.md'))[0].synonyms, ['ordem', 'compra']);
  });

  it('decisions (--decision) go to the ledger once, with the options not taken as rejected alternatives', () => {
    const dir = project();
    g(dir, 'start', { type: 'bugfix' });
    answerAll(dir, 'bugfix');
    const out = g(dir, 'close', { by: 'tl' });
    assert.equal(out.decisions_recorded.length, 1);
    const ledger = require('../bin/lib/oxe-decisions.cjs').list(path.join(dir, '.oxe', 'program'));
    const d = ledger.find((x) => x.source === out.decisions_recorded[0].grill.replace(/^/, 'grill:'));
    assert.ok(d);
    assert.equal(d.title, 'pergunta do ramo scope: opção alfa');
    assert.deepEqual(d.alternatives.map((a) => a.text), ['opção beta']);
    assert.match(d.alternatives[0].reason, /não escolhida no grill Q-\d+: evidência/);
    assert.equal(g(dir, 'export').decisions_recorded.length, 0, 'idempotent');
  });

  it('the human text of GLOSSARY.md outside the markers is kept', () => {
    const dir = project();
    const file = path.join(dir, '.oxe', 'GLOSSARY.md');
    fs.writeFileSync(file, '# Glossário\n\nNota do time: revisar com o jurídico.\n');
    grill.writeGlossary(file, [{ term: 'Conta', definition: 'cadastro do cliente', synonyms: [] }]);
    grill.writeGlossary(file, [{ term: 'Conta', definition: 'cadastro ativo do cliente', synonyms: ['usuário'] }]);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /Nota do time: revisar com o jurídico\./);
    assert.equal((text.match(/oxe:glossary:begin/g) || []).length, 1);
    assert.match(text, /cadastro ativo do cliente/);
  });

  it('resumes across sessions: a second start keeps the state (no restart)', () => {
    const dir = project();
    g(dir, 'start', { type: 'bugfix' });
    g(dir, 'ask', { branch: 'problem', question: 'qual o erro hoje?', recommended: 'tela branca' });
    const again = g(dir, 'start', { type: 'feature' });
    assert.equal(again.resumed, true);
    assert.equal(again.type, 'bugfix');
    assert.equal(g(dir, 'status').open_questions.length, 1);
  });

  it('CLI: start, ask, answer by positional, status --json', () => {
    const dir = project();
    const run = (...a) => spawnSync(process.execPath, [CLI, 'grill', ...a, '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(run('start', 'bugfix').status, 0);
    assert.equal(run('ask', '--branch', 'problem', '--question', 'qual o erro hoje?', '--options', 'a | b', '--recommended', 'a').status, 0);
    const ans = run('answer', 'Q-1', 'ok');
    assert.equal(ans.status, 0, ans.stderr);
    assert.match(ans.stdout, /Q-1: a \(recomendada aceita\)/);
    const st = JSON.parse(run('status', '--json').stdout);
    assert.equal(st.branches.find((b) => b.id === 'problem').decided, 1);
    assert.equal(run('close').status, 1);
  });
});

describe('grill decisions keep their anchor (criteria and stories → ADR)', () => {
  it('--affects A*/US-* of a decision question become the decision\'s criteria and stories, listed in the ADR', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({}));
    g(dir, 'start', { type: 'investigação' });
    for (const b of ['problem', 'scope', 'risks']) {
      const q = g(dir, 'ask', { branch: b, question: `pergunta do ramo ${b}?`, options: 'opção alfa | opção beta', recommended: 'opção alfa', why: 'evidência', decision: b === 'scope', affects: b === 'scope' ? 'A3,US-2,R1' : '' });
      g(dir, 'answer', { id: q.id, choice: 'ok' });
      g(dir, 'confirm', { branch: b });
    }
    g(dir, 'close', { by: 'po' });
    const d = require('../bin/lib/oxe-decisions.cjs').list(path.join(dir, '.oxe', 'program')).find((x) => /^grill:/.test(x.source));
    assert.deepEqual(d.criteria, ['A3']);
    assert.deepEqual(d.stories, ['US-2']);
    const adrDir = path.join(dir, 'docs', 'adr');
    const adr = fs.readdirSync(adrDir).filter((f) => /^D-/.test(f)).map((f) => fs.readFileSync(path.join(adrDir, f), 'utf8')).join('\n');
    assert.match(adr, /\*\*Critérios:\*\* A3/);
    assert.match(adr, /\*\*Histórias:\*\* US-2/);
  });
});
