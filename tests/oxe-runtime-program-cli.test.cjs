'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// As flags de program/dossier/signoff/feedback foram parar no parser errado (parseContextArgs) e os testes, que
// chamavam o operational direto, não pegaram. Este teste passa pela CLI real.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function cli(cwd, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^OXESPACE_/i.test(key)) delete env[key];
  return spawnSync(process.execPath, [CLI, 'runtime', ...args, '--json', cwd], { encoding: 'utf8', env });
}

function json(res) {
  const start = res.stdout.indexOf('{');
  assert.ok(start >= 0, `sem JSON: ${res.stdout}\n${res.stderr}`);
  return JSON.parse(res.stdout.slice(start));
}

describe('CLI runtime program/feedback/signoff', () => {
  it('aceita as flags e executa o fluxo pela linha de comando', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cli-program-'));
    dirs.push(tmp);
    fs.mkdirSync(path.join(tmp, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.oxe', 'STATE.md'), '# STATE\n', 'utf8');
    fs.writeFileSync(path.join(tmp, '.oxe', 'ROADMAP.md'), '# R\n\n## Fase 1 — A\n\n**Critérios de aceite:** A1\n\n## Fase 2 — B\n\n**Critérios de aceite:** A2\n', 'utf8');

    assert.equal(json(cli(tmp, ['program', 'init'])).progress.total, 2);
    assert.equal(json(cli(tmp, ['program', 'start', '--phase', 'F1'])).state.active_phase, 'F1');

    const cr = cli(tmp, ['feedback', '--class', 'defect', '--criteria', 'A1', '--by', 'qa', '--summary', 'o fluxo não salva o rascunho']);
    assert.equal(cr.status, 0, cr.stderr || cr.stdout);
    assert.equal(json(cr).cr.id, 'CR-01');
    assert.deepEqual(json(cli(tmp, ['feedback', 'list'])).changes.map((c) => c.id), ['CR-01']);

    const bad = cli(tmp, ['feedback', '--class', 'bug', '--summary', 'classe inexistente aqui']);
    assert.notEqual(bad.status, 0);

    const so = cli(tmp, ['signoff', '--phase', 'F1', '--criteria', 'A1', '--by', 'eduardo', '--message', 'ok']);
    assert.equal(so.status, 0, so.stderr || so.stdout);
    assert.deepEqual(json(so).criteria, ['A1']);
  });
});
