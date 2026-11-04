'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeProjectedBlock } = require('../bin/lib/oxe-operational.cjs');

// Regressão do e2e "linkly": `runtime verify` sobrescrevia o STATE.md curado (fase, decisões,
// próximo passo) com uma projeção completa e a fase passava a ser lida como null.

const PROJECTION = [
  '# OXE — Estado',
  '',
  '<!-- Gerado automaticamente pelo Projection Engine — não editar diretamente -->',
  '',
  '## Fase atual',
  '',
  '- **Status da run:** completed',
  '',
  '## Progresso',
  '',
  '- **Concluídos (2):** T1, T2',
].join('\n');

describe('writeProjectedBlock — projeção não destrutiva', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-markers-'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('arquivo humano sem marcadores: preserva o conteúdo e anexa bloco rebaixado', () => {
    const file = path.join(tmp, 'STATE.md');
    const human = '# OXE — Estado\n\n## Fase atual\n\n`plan_ready` — plano aprovado.\n\n## Decisões persistentes\n\n- D-01: sem deps\n';
    fs.writeFileSync(file, human, 'utf8');
    assert.equal(writeProjectedBlock(file, PROJECTION, 'Runtime (projetado)'), 'appended');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith(human.trimEnd()), 'conteúdo humano deve permanecer intacto no topo');
    assert.match(text, /<!-- oxe:runtime:begin -->\n## Runtime \(projetado\)/);
    assert.match(text, /### Progresso/);
    assert.equal((text.match(/^# /gm) || []).length, 1, 'só o H1 humano');
    assert.equal(text.match(/^## Fase atual/gm).length, 1, 'cabeçalhos projetados são rebaixados');
  });

  it('segunda projeção substitui só o bloco (idempotente)', () => {
    const file = path.join(tmp, 'STATE.md');
    writeProjectedBlock(file, PROJECTION.replace('T1, T2', 'T1, T2, T3').replace('(2)', '(3)'), 'Runtime (projetado)');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal((text.match(/oxe:runtime:begin/g) || []).length, 1);
    assert.match(text, /Concluídos \(3\):\*\* T1, T2, T3/);
    assert.doesNotMatch(text, /Concluídos \(2\)/);
    assert.match(text, /D-01: sem deps/);
  });

  it('arquivo ausente ou projeção legada completa: escreve a projeção inteira entre marcadores', () => {
    const fresh = path.join(tmp, 'VERIFY.md');
    assert.equal(writeProjectedBlock(fresh, PROJECTION, 'Verificação'), 'replaced');
    const freshText = fs.readFileSync(fresh, 'utf8');
    assert.ok(freshText.startsWith('<!-- oxe:runtime:begin -->\n# OXE — Estado'));

    const legacy = path.join(tmp, 'LEGACY.md');
    fs.writeFileSync(legacy, PROJECTION, 'utf8');
    assert.equal(writeProjectedBlock(legacy, PROJECTION, 'Verificação'), 'replaced');

    // Re-projetar um arquivo que só tem o bloco mantém a forma completa (sem rebaixar).
    assert.equal(writeProjectedBlock(fresh, PROJECTION, 'Verificação'), 'block');
    assert.match(fs.readFileSync(fresh, 'utf8'), /^<!-- oxe:runtime:begin -->\n# OXE — Estado/);
  });
});
