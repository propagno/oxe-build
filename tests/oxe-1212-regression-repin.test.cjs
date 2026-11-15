'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');

// OxeSpace 15/11 (OxeChat F3, chat-sess): F2's regression record kept the pre-CR hash of the re-frozen A6 test, and
// every later verify failed `reg-f2-check-accept-a6: acceptance_tampered`. `program regression repin` re-pins it.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const git = (dir, ...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });

const ROADMAP = '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A6\n\n## Fase 2 — Outra\n\n**Depende de:** F1\n**Critérios de aceite:** A7\n';
const OLD = "test('notifica', () => { expect('Terminou') })\n";
const NEW = "test('notifica', () => { expect('Concluído') })\n";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-repin-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A6 | a | m |\n| A7 | b | m |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), ROADMAP);
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'r@r'); git(dir, 'config', 'user.name', 'r');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'a6.test.ts'), NEW);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'refrozen A6');
  op.runtimeProgramInit(dir, null, {});
  const pdir = path.join(dir, '.oxe', 'program');
  const s = programLib.readProgram(pdir);
  Object.assign(s.phases.find((x) => x.id === 'F1'), { status: 'closed', closed_at: new Date().toISOString(), closed_commit: 'abc' });
  s.active_phase = 'F2';
  programLib.writeProgram(pdir, s);
  fs.mkdirSync(path.join(pdir, 'regression'), { recursive: true });
  // the stale snapshot: the pre-CR content's hash
  fs.writeFileSync(path.join(pdir, 'regression', 'F1.json'), JSON.stringify({ schema_version: 1, phase: 'F1', checks: [
    { id: 'check-accept-a6', acceptance_ref: 'A6', command: 'npx vitest run tests/a6.test.ts', frozen_files: [{ path: 'tests/a6.test.ts', sha256: sha(OLD) }] },
  ] }, null, 2));
  return { dir, regFile: path.join(pdir, 'regression', 'F1.json') };
}

describe('program regression repin', () => {
  it('re-pins a closed phase entry to the committed file, audited; a second run changes nothing', () => {
    const { dir, regFile } = project();
    const dry = op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A6', by: 'TL', reason: 'CR-F2-8 re-congelou o A6', dryRun: true });
    assert.equal(dry.changes.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(regFile, 'utf8')).checks[0].frozen_files[0].sha256, sha(OLD), 'dry run writes nothing');
    const r = op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A6', by: 'TL', reason: 'CR-F2-8 re-congelou o A6' });
    assert.deepEqual(r.changes.map((c) => [c.check, c.from, c.to]), [['check-accept-a6', sha(OLD), sha(NEW)]]);
    const doc = JSON.parse(fs.readFileSync(regFile, 'utf8'));
    assert.equal(doc.checks[0].frozen_files[0].sha256, sha(NEW));
    assert.equal(doc.repins[0].by, 'TL');
    assert.match(doc.repins[0].reason, /CR-F2-8/);
    assert.equal(op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A6', by: 'TL', reason: 'de novo, nada muda' }).changes.length, 0);
    assert.equal(doc.repins.length, 1);
    // the loaded regression check of the next phase now carries the new hash
    const loaded = programLib.loadRegressionChecks(path.join(dir, '.oxe', 'program'), programLib.readProgram(path.join(dir, '.oxe', 'program')), 'F2');
    assert.equal(loaded[0].id, 'reg-f1-check-accept-a6');
    assert.equal(loaded[0].frozen_files[0].sha256, sha(NEW));
  });

  it('refuses an uncommitted edit, an open phase, an unknown criterion and a missing reason — nothing written', () => {
    const { dir, regFile } = project();
    const before = fs.readFileSync(regFile, 'utf8');
    fs.writeFileSync(path.join(dir, 'tests', 'a6.test.ts'), NEW + '// edit\n');
    assert.throws(() => op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A6', by: 'TL', reason: 'tentativa com edição' }), /não commitada/);
    git(dir, 'checkout', '--', 'tests/a6.test.ts');
    assert.throws(() => op.runtimeProgramRegressionRepin(dir, null, { phase: 'F2', criteria: 'A7', by: 'TL', reason: 'fase ainda aberta' }), /não está fechada/);
    assert.throws(() => op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A9', by: 'TL', reason: 'critério que não existe' }), /nenhum teste congelado de A9/);
    assert.throws(() => op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A6', by: 'TL' }), /motivo/);
    assert.equal(fs.readFileSync(regFile, 'utf8'), before);
  });

  it('a repeated criterion (A6,A6) records one change', () => {
    const { dir, regFile } = project();
    const r = op.runtimeProgramRegressionRepin(dir, null, { phase: 'F1', criteria: 'A6,a6', by: 'TL', reason: 'critério repetido no pedido' });
    assert.equal(r.changes.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(regFile, 'utf8')).repins.length, 1);
  });

  it('the CLI follows the active session of STATE.md (the program under .oxe/sessions/<s>/program)', () => {
    const { dir } = project();
    // move the program into a session, the layout of a project with an active session
    const sdir = path.join(dir, '.oxe', 'sessions', 'chat-sess');
    fs.mkdirSync(sdir, { recursive: true });
    fs.renameSync(path.join(dir, '.oxe', 'program'), path.join(sdir, 'program'));
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n\n**active_session:** sessions/chat-sess\n');
    const r = spawnSync(process.execPath, [CLI, 'program', 'regression', 'repin', 'F1', '--criteria', 'A6', '--by', 'TL', '--reason', 'sessão ativa do projeto', '--dir', dir, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).changes.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(sdir, 'program', 'regression', 'F1.json'), 'utf8')).checks[0].frozen_files[0].sha256, sha(NEW));
  });

  it('the CLI: program regression repin F1 --criteria A6 --by --reason', () => {
    const { dir, regFile } = project();
    const r = spawnSync(process.execPath, [CLI, 'program', 'regression', 'repin', 'F1', '--criteria', 'A6', '--by', 'TL', '--reason', 'CR-F2-8 re-congelou o A6', '--dir', dir, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).changes.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(regFile, 'utf8')).checks[0].frozen_files[0].sha256, sha(NEW));
  });
});
