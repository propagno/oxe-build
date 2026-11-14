'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const lib = require('../bin/lib/oxe-decisions.cjs');
const adr = require('../bin/lib/oxe-adr.cjs');

// 1.21.2 — one decision ledger (.oxe/program/decisions.ndjson) for the DISCUSS D-NN and the D-F2-n ids, projected into
// versioned ADRs (docs/adr/), with supersede / retire, kept in step by every change.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-adr-')); dirs.push(d); fs.mkdirSync(path.join(d, '.oxe'), { recursive: true }); return d; };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

const DISCUSS = [
  '# OXE — Discuss', '', '## Decisões', '',
  '| ID   | Decisão                          | Data       | Impacto no plano |',
  '|------|----------------------------------|------------|------------------|',
  '| D-01 | Autenticação via JWT *(revertida por D-02)* | 2026-11-01 | src/auth |',
  '| D-02 | Autenticação por sessão no servidor | 2026-11-03 | src/auth, src/session |',
  '| D-03 | (descrição clara e acionável)    | YYYY-MM-DD | (arquivos) |',
  '',
].join('\n');

describe('decisions → ADRs', () => {
  it('add writes the ADR and the index; text outside the markers survives a republish', () => {
    const dir = tmp();
    const out = op.runtimeDecision(dir, null, { action: 'add', title: 'Fila local com retry exponencial', phase: 'F2', context: 'A rede do celular cai.', consequences: 'Mensagens podem chegar fora de ordem.', check: 'node -e 0', alternatives: ['Enviar direto sem fila::perde mensagens offline'], by: 'tech lead' });
    assert.equal(out.decision.id, 'D-F2-1');
    assert.equal(out.adr.dir, 'docs/adr');
    const file = 'docs/adr/D-F2-1-fila-local-com-retry-exponencial.md';
    const text = read(dir, file);
    for (const re of [/^<!-- oxe-adr:begin/, /# D-F2-1 — Fila local com retry exponencial/, /\*\*Status:\*\* Aceita/, /## Contexto\n\nA rede do celular cai\./, /## Alternativas consideradas\n\n- \*\*Enviar direto sem fila\*\* — recusada: perde mensagens offline \(por tech lead\)/, /## Consequências\n\nMensagens podem chegar fora de ordem\./, /roda `node -e 0` \(gate `decision-D-F2-1`\)/]) assert.match(text, re);
    assert.match(read(dir, 'docs/adr/README.md'), /\| \[D-F2-1\]\(D-F2-1-fila-local-com-retry-exponencial\.md\) \| Fila local com retry exponencial \| F2 \|/);
    fs.writeFileSync(path.join(dir, file), text.replace('_(texto livre — preservado a cada publicação)_', 'Discutido na revisão de 12/11.'));
    op.runtimeDecision(dir, null, { action: 'add', title: 'Outra decisão qualquer', phase: 'F2' });
    assert.match(read(dir, file), /Discutido na revisão de 12\/11\./);
  });

  it('--supersedes marks the old one and links both ways; lint warns a task citing it', () => {
    const dir = tmp();
    op.runtimeDecision(dir, null, { action: 'add', title: 'Usar SQLite local', phase: 'F1' });
    const out = op.runtimeDecision(dir, null, { action: 'add', title: 'Usar IndexedDB no renderer', phase: 'F1', supersedes: 'D-F1-1' });
    const old = lib.list(path.join(dir, '.oxe', 'program')).find((d) => d.id === 'D-F1-1');
    assert.equal(old.status, 'superseded');
    assert.equal(old.superseded_by, 'D-F1-2');
    assert.match(read(dir, 'docs/adr/D-F1-1-usar-sqlite-local.md'), /\*\*Status:\*\* Substituída por \[D-F1-2\]\(D-F1-2-usar-indexeddb-no-renderer\.md\)/);
    assert.match(read(dir, 'docs/adr/D-F1-2-usar-indexeddb-no-renderer.md'), /\*\*Substitui:\*\* \[D-F1-1\]/);
    assert.equal(out.decision.supersedes, 'D-F1-1');
    const lint = lib.lintDecisions({ tasks: [{ id: 'T1', decisions: ['D-F1-1'] }] }, lib.list(path.join(dir, '.oxe', 'program')), 'F1');
    assert.ok(lint.warnings.some((w) => /T1: cita D-F1-1, que está substituída por D-F1-2/.test(w)), lint.warnings.join('\n'));
    assert.throws(() => op.runtimeDecision(dir, null, { action: 'add', title: 'De novo', supersedes: 'D-F1-1' }), /já está superseded/);
  });

  it('status retired needs a reason; the index groups by status', () => {
    const dir = tmp();
    op.runtimeDecision(dir, null, { action: 'add', title: 'Feature flag para o modo escuro', phase: 'F1' });
    assert.throws(() => op.runtimeDecision(dir, null, { action: 'status', id: 'D-F1-1', status: 'retired' }), /informe o motivo/);
    op.runtimeDecision(dir, null, { action: 'status', id: 'D-F1-1', status: 'retired', reason: 'o modo escuro virou padrão' });
    const idx = read(dir, 'docs/adr/README.md');
    assert.match(idx, /## Aposentadas/);
    assert.doesNotMatch(idx, /## Aceitas/);
  });

  it('import brings the DISCUSS table with its ids; a reverted row comes in superseded; placeholders and repeats are skipped', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.oxe', 'DISCUSS.md'), DISCUSS);
    const out = op.runtimeDecision(dir, null, { action: 'import' });
    assert.deepEqual(out.imported, ['D-01', 'D-02']);
    const ds = lib.list(path.join(dir, '.oxe', 'program'));
    assert.equal(ds.find((d) => d.id === 'D-01').status, 'superseded');
    assert.equal(ds.find((d) => d.id === 'D-01').superseded_by, 'D-02');
    assert.equal(ds.find((d) => d.id === 'D-01').title, 'Autenticação via JWT');
    assert.equal(ds.find((d) => d.id === 'D-02').at.slice(0, 10), '2026-11-03');
    assert.match(read(dir, 'docs/adr/D-02-autenticacao-por-sessao-no-servidor.md'), /\*\*Origem:\*\* DISCUSS\.md/);
    const again = op.runtimeDecision(dir, null, { action: 'import' });
    assert.deepEqual(again.imported, []);
    assert.deepEqual(again.skipped.sort(), ['D-01', 'D-02']);
  });

  it('adr: false turns publishing off; spikes are not ADRs; the folder cannot be inside .oxe/', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ adr: false }));
    const out = op.runtimeDecision(dir, null, { action: 'add', title: 'Sem ADR aqui', phase: 'F1' });
    assert.equal(out.adr, null);
    assert.equal(fs.existsSync(path.join(dir, 'docs', 'adr')), false);
    assert.throws(() => adr.publish(dir, '.oxe/adr', []), /dentro de \.oxe/);
    const r = adr.publish(dir, 'docs/decisions', [{ id: 'D-SPIKE-T1', title: 'spike', at: '2026-01-01' }, { id: 'D-1', title: 'Uma decisão real', at: '2026-01-02' }]);
    assert.deepEqual(r.written.sort(), ['docs/decisions/D-1-uma-decisao-real.md', 'docs/decisions/README.md']);
  });

  it('CLI: decision status / import / publish', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.oxe', 'DISCUSS.md'), DISCUSS);
    const run = (...args) => spawnSync(process.execPath, [CLI, 'decision', ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    let r = run('import');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /importadas do DISCUSS\.md: D-01, D-02/);
    r = run('status', 'D-02', 'retired', '--reason', 'mudou para OAuth');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /D-02 (→|->) retired \(mudou para OAuth\)/);
    r = run('publish', '--out', 'docs/arq/adr');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'arq', 'adr', 'README.md')));
    r = run('status', 'D-02');
    assert.notEqual(r.status, 0);
  });
});
