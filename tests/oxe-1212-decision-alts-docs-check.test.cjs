'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const decisions = require('../bin/lib/oxe-decisions.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');

// 1.21.2 — OXB-182: alternatives that lost, with who rejected them; OXB-183: closed documents vs today's code.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dd-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Depois\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'Guardar a fila em um arquivo JSON local por workspace', wave: 1, files: ['src/a.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, 'src/a.ts', 'export function foo() { return 1 }\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  return dir;
}
const pdir = (dir) => path.join(dir, '.oxe', 'program');

describe('OXB-182: decision alternatives', () => {
  it('two alternatives appear in decision list; a rejection by someone else needs a link; old records stay valid', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [CLI, 'decision', 'add', '--title', 'A fila fica no SQLite do app', '--by', 'tl', '--alt', 'arquivo JSON local por workspace::corrompe com dois processos escrevendo', '--alt', 'Redis embutido::dependência nativa no instalador::infra::CR-12', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const ls = spawnSync(process.execPath, [CLI, 'decision', 'list', '--dir', dir], { encoding: 'utf8' });
    assert.match(ls.stdout, /(✗|FAIL) arquivo JSON local por workspace . corrompe com dois processos escrevendo \(por tl\)/);
    assert.match(ls.stdout, /(✗|FAIL) Redis embutido . dependência nativa no instalador \(por infra, CR-12\)/);
    assert.throws(() => decisions.add(pdir(dir), { title: 'outra decisão', by: 'tl', alternatives: ['Kafka::pesado demais::arquiteto'] }), /exige um link/);
    decisions.add(pdir(dir), { title: 'decisão antiga sem alternativas', by: 'po' });
    assert.equal(decisions.list(pdir(dir)).length, 2);
  });

  it('the lint warns when a task proposes an alternative already rejected', () => {
    const dir = project();
    decisions.add(pdir(dir), { title: 'A fila fica no SQLite do app', by: 'tl', alternatives: ['arquivo JSON local por workspace::corrompe com dois processos'] });
    const lint = op.runtimePlanLint(dir, null, {});
    assert.ok(lint.warnings.some((w) => /T1: propõe "arquivo JSON local por workspace", alternativa já recusada em D-1/.test(w)), lint.warnings.join('\n'));
  });
});

describe('OXB-183: docs check', () => {
  function closedPhaseWith(dir, text) {
    const s = programLib.readProgram(pdir(dir));
    s.phases[0].status = 'closed';
    programLib.writeProgram(pdir(dir), s);
    decisions.add(pdir(dir), { title: 'O cálculo fica em src/a.ts#foo', text, phase: 'F1', by: 'tl' });
  }

  it('deleted → "não existe mais"; moved → "mudou de lugar"; a planned new file is not a claim', () => {
    const dir = project();
    closedPhaseWith(dir, 'Criar src/novo-modulo.ts para a fila.');
    assert.deepEqual(op.runtimeDocsCheck(dir, null, {}).divergences, []);
    write(dir, 'src/b.ts', 'export function foo() { return 2 }\n');
    write(dir, 'src/a.ts', 'export const outra = 1\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'move');
    let out = op.runtimeDocsCheck(dir, null, {});
    assert.equal(out.divergences.length, 1, JSON.stringify(out.divergences));
    assert.deepEqual([out.divergences[0].cite, out.divergences[0].why, out.divergences[0].now], ['src/a.ts#foo', 'mudou de lugar', ['src/b.ts']]);
    fs.rmSync(path.join(dir, 'src', 'b.ts')); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'rm');
    out = op.runtimeDocsCheck(dir, null, {});
    assert.equal(out.divergences[0].why, 'não existe mais');
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'DOCS-CHECK.md'), 'utf8'), /não existe mais/);
  });

  it('the check of an active decision of a closed phase runs again: failing → "check falhou", passing → nothing', () => {
    const dir = project();
    const s = programLib.readProgram(pdir(dir));
    s.phases[0].status = 'closed';
    programLib.writeProgram(pdir(dir), s);
    decisions.add(pdir(dir), { title: 'flag ligada', phase: 'F1', by: 'tl', check: 'node -e "process.exit(require(\'fs\').existsSync(\'flag\')?0:1)"' });
    assert.equal(op.runtimeDocsCheck(dir, null, {}).divergences[0].why, 'check falhou');
    write(dir, 'flag', '1');
    const t0 = Date.now();
    assert.deepEqual(op.runtimeDocsCheck(dir, null, {}).divergences, []);
    assert.ok(Date.now() - t0 < 5000);
  });
});
