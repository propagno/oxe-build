'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const st = require('../bin/lib/oxe-spec-stress.cjs');

// 1.21.2 — OXB-143: stress the spec with fixed methods in independent readers; accepted changes become amendments.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const SPEC = '# SPEC\n\n## Objetivo\n\nSincronizar a fila de tarefas entre o desktop e o celular.\n\n## Decisões internas\n\nsegredo da conversa\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | O celular mostra a fila de tarefas em até 2 s | teste |\n| A2 | O token de pareamento expira | teste |\n';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ss-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/SPEC.md', SPEC);
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A2\n');
  write(dir, '.oxe/config.json', '{}');
  op.runtimeProgramInit(dir, null, {});
  return dir;
}
const reply = (changes) => ({ ok: true, text: JSON.stringify({ result: JSON.stringify({ changes }) }) });

describe('OXB-143: spec stress', () => {
  it('picks up to three distinct methods: best match first, reproducible', () => {
    const methods = st.loadMethods();
    assert.ok(methods.length >= 5);
    const pick = st.chooseMethods({ id: 'A2', text: 'O token de pareamento expira' }, methods);
    assert.ok(pick.length >= 2 && pick.length <= 3);
    assert.equal(pick[0].id, 'adversary');
    assert.equal(new Set(pick.map((m) => m.id)).size, pick.length);
    assert.deepEqual(st.chooseMethods({ id: 'A2', text: 'O token de pareamento expira' }, methods).map((m) => m.id), pick.map((m) => m.id));
  });

  it('the reader gets only the short summary and the criterion; partial acceptance records only the chosen ones as amendments with origin stress', async () => {
    const dir = project();
    const prompts = [];
    const reviewer = async (prompt) => { prompts.push(prompt); return /token de pareamento/.test(prompt) ? reply([{ text: 'O token expira em 10 min e não pode ser reutilizado', rationale: 'replay' }]) : reply([{ text: 'Com a fila vazia, mostra o estado vazio', rationale: 'vazio' }]); };
    const out = await op.runtimeSpecStress(dir, null, { phase: 'F1', methods: 'adversary', reviewer });
    assert.equal(out.proposals.filter((p) => p.n).length, 2);
    for (const p of prompts) {
      assert.match(p, /Resumo do objetivo: Sincronizar a fila/);
      assert.ok(!p.includes('segredo da conversa'));
      assert.ok(!/A1[\s\S]*A2|A2[\s\S]*A1/.test(p.replace(/Critério A\d+:/, '')), 'one criterion per reader');
    }
    const a2 = out.proposals.find((p) => p.criterion === 'A2');
    const acc = await op.runtimeSpecStress(dir, null, { action: 'accept', run: out.id, changes: String(a2.n), by: 'po' });
    assert.deepEqual(acc.accepted.map((a) => a.criterion), ['A2']);
    const spec = fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8');
    assert.match(spec, /A2 \| O token de pareamento expira.*não pode ser reutilizado/);
    assert.doesNotMatch(spec, /estado vazio/);
    const changes = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8');
    assert.match(changes, /"origin":"stress"/);
    assert.match(changes, /"method":"adversary"/);
  });
});
