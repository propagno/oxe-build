'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const q = require(path.join(__dirname, '..', 'bin', 'lib', 'oxe-quick.cjs'));

// oxespace-00, 28/11 (PR #1279): the title was cut at 80 chars inside "(" with no --title to fix it.
const OBJECTIVE = 'Deixar a main verde para a tag v1.6.3: atualizar code-session-identity (composer tab order e scroll do fim de turno)';

describe('quick promote — título do PR', () => {
  it('corta em fronteira de palavra, sem parêntese aberto, com no máximo 80 caracteres', () => {
    const t = q.prTitleOf({ key: 'OXE-494', objective: OBJECTIVE }, []);
    assert.ok(t.length <= 80, t);
    assert.ok(t.startsWith('OXE-494: '), t);
    assert.ok(t.endsWith('…'), t);
    assert.equal((t.match(/\(/g) || []).length, (t.match(/\)/g) || []).length, t);
    assert.ok(OBJECTIVE.includes(t.slice('OXE-494: '.length, -1)), `corte no meio de palavra: ${t}`);
  });

  it('usa o assunto do primeiro commit do quick quando ele já cita a chave', () => {
    const commits = [
      { sha: 'b', subject: 'test(e2e): scroll do fim de turno (OXE-494)' },
      { sha: 'a', subject: 'fix(e2e): main green for v1.6.3 (OXE-494)' },
    ];
    assert.equal(q.prTitleOf({ key: 'OXE-494', objective: OBJECTIVE }, commits), 'fix(e2e): main green for v1.6.3 (OXE-494)');
    assert.ok(q.prTitleOf({ key: 'OXE-494', objective: OBJECTIVE }, [{ sha: 'a', subject: 'wip' }]).startsWith('OXE-494: '));
  });

  it('--title prevalece sobre o título derivado', () => {
    assert.equal(q.prTitleOf({ key: 'OXE-494', objective: OBJECTIVE }, [], 'fix(e2e): título manual (OXE-494)'), 'fix(e2e): título manual (OXE-494)');
    assert.equal(q.shortenTitle('curto'), 'curto');
  });
});
