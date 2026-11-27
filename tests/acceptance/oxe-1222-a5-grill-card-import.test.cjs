'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const grillLib = require('../../bin/lib/oxe-grill.cjs');
const op = require('../../bin/lib/oxe-operational.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkProject(prefix = 'oxe-1222-a5-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), [
    '---',
    'oxe_doc: spec',
    'status: approved',
    '---',
    '# SPEC',
    '## Objetivo',
    'Validar grill promote e spec check --card.',
    '## Critérios de aceite',
    '| ID | Critério | Risco | Como verificar |',
    '|---|---|---|---|',
    '| A1 | smoke | P2 | `node -e "0"` |',
    '## Fora de escopo',
    '- Nada',
  ].join('\n'));
  return dir;
}

describe('A5 — OXB-222-05: Grill --card notice, grill promote, spec check --card, and safe grill import', () => {
  it('OXB-222-05: grill --card warns path, grill promote copies to active grill, and spec check --card resolves card grill', () => {
    const dir = mkProject('oxe-1222-a5-card-');

    // 1. grill start --card OB-44 emits explicit path notice
    const startRes = spawnSync(
      process.execPath,
      [BIN, 'grill', 'start', '--type', 'bugfix', '--title', 'Card OB-44', '--card', 'OB-44', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(startRes.status, 0, startRes.stderr || startRes.stdout);
    const combinedStart = `${startRes.stdout}\n${startRes.stderr}`;
    assert.match(combinedStart, /\.oxe\/alm\/grill\/OB-44/i, 'grill --card must clearly mention .oxe/alm/grill/OB-44');
    assert.match(combinedStart, /grill promote --card OB-44/i, 'grill --card notice must suggest grill promote --card OB-44');

    // Add a fact under --card OB-44
    const factRes = spawnSync(
      process.execPath,
      [BIN, 'grill', 'fact', '--branch', 'problem', '--text', 'Bug confirmed in parser', '--source', 'src/parser.js:12', '--card', 'OB-44', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(factRes.status, 0, factRes.stderr || factRes.stdout);

    // 2. spec check --card OB-44 resolves card grill (instead of reporting grill absent)
    const checkWithCard = op.runtimeSpecCheck(dir, null, { card: 'OB-44', fast: true });
    assert.ok(checkWithCard.summary && checkWithCard.summary.grill && checkWithCard.summary.grill !== 'ausente', `spec check --card must detect card grill, got: ${JSON.stringify(checkWithCard.summary)}`);

    const cliCheck = spawnSync(
      process.execPath,
      [BIN, 'spec', 'check', '--card', 'OB-44', '--fast', '--json', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    const cliCheckOut = JSON.parse(cliCheck.stdout);
    assert.notEqual(cliCheckOut.summary.grill, 'ausente', 'CLI spec check --card OB-44 must resolve card grill');

    // 3. grill promote --card OB-44 copies card grill into active .oxe/grill/
    const promoRes = spawnSync(
      process.execPath,
      [BIN, 'grill', 'promote', '--card', 'OB-44', '--json', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(promoRes.status, 0, promoRes.stderr || promoRes.stdout);
    const promoOut = JSON.parse(promoRes.stdout);
    assert.equal(promoOut.promoted, true);
    assert.equal(promoOut.card, 'OB-44');
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'grill', 'grill.ndjson')), 'promoted grill.ndjson must exist in .oxe/grill/');
    const activeStatus = grillLib.status(path.join(dir, '.oxe', 'grill'));
    assert.equal(activeStatus.started, true);
    assert.equal(activeStatus.questions.length, 1);
  });

  it('OXB-222-05: grill import loads briefing in batch and never auto-confirms branches', () => {
    const dir = mkProject('oxe-1222-a5-import-');
    const briefingPath = path.join(dir, 'briefing.json');
    fs.writeFileSync(briefingPath, JSON.stringify({
      type: 'bugfix',
      title: 'Fix flaky parser',
      // Malicious/accidental auto-confirm flags MUST be ignored — branches remain unconfirmed
      confirm: ['problem', 'scope'],
      confirmed: true,
      close: true,
      facts: [
        { branch: 'problem', text: 'Parser crashes on empty input', source: 'src/parser.js:42' },
        { branch: 'scope', text: 'Only fix empty input guard in v1', source: 'briefing.md' },
      ],
      questions: [
        {
          branch: 'edges',
          question: 'How should whitespace-only lines behave?',
          recommended: 'Return empty array without throwing',
          why: 'Matches existing caller contract',
          answer: 'ok',
        },
        {
          branch: 'risks',
          question: 'Could downstream callers expect null instead of []?',
          recommended: 'Keep [] and add unit coverage',
          why: 'Safe default',
        },
      ],
      terms: [
        { term: 'Empty payload', definition: 'Input string with zero non-whitespace characters', synonyms: ['blank body'] },
      ],
    }, null, 2));

    const importRes = spawnSync(
      process.execPath,
      [BIN, 'grill', 'import', '--from', briefingPath, '--json', '--dir', dir],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(importRes.status, 0, importRes.stderr || importRes.stdout);
    const out = JSON.parse(importRes.stdout);
    assert.equal(out.imported, true);
    assert.equal(out.facts_imported, 2);
    assert.equal(out.questions_imported, 2);
    assert.equal(out.terms_imported, 1);
    assert.equal(out.unconfirmed, true);

    const st = grillLib.status(path.join(dir, '.oxe', 'grill'));
    assert.equal(st.started, true);
    assert.equal(st.closed, null, 'grill import must NEVER close the grill');
    assert.equal(st.branches.every((b) => b.confirmed === false), true, 'grill import must leave every branch unconfirmed');
    assert.equal(st.terms.length, 1);
    assert.equal(st.questions.length, 4);
    assert.equal(st.questions.filter((q) => q.status === 'open').length, 1);
    assert.equal(st.questions.filter((q) => q.status === 'decided').length, 3);
  });
});
