'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');

// 1.21.2 — OXB-135: a program that changes more than one repository.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const repo = (dir) => { git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b'); };

function setup() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pm-'));
  dirs.push(top);
  const dir = path.join(top, 'coord');
  const ui = path.join(top, 'ui');
  write(ui, 'src/app.kt', 'fun main() {}\n');
  repo(ui);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'contrato', wave: 1, files: ['src/contract.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    { id: 'T2', title: 'android', wave: 1, repo: 'ui', files: ['src/app.kt'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
  ] }));
  write(dir, 'src/contract.ts', 'x\n');
  repo(dir);
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return { dir, ui };
}

describe('OXB-135: program members', () => {
  it('member add/list; unknown repo and a task touching two repos are lint errors', () => {
    const { dir } = setup();
    const r = spawnSync(process.execPath, [CLI, 'program', 'member', 'add', '--name', 'ui', '--path', '../ui', '--order', '2', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /2\. ui . \.\.\/ui \(main\)/);
    assert.throws(() => op.runtimeProgramMember(dir, null, { action: 'add', name: 'x', path: '../nao-existe' }), /não é um repositório git/);
    const pj = path.join(dir, '.oxe', 'PLAN.json');
    const doc = JSON.parse(fs.readFileSync(pj, 'utf8'));
    doc.tasks.push({ id: 'T3', title: 'x', wave: 1, repo: 'web', files: ['a.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } });
    doc.tasks.push({ id: 'T4', title: 'y', wave: 1, repo: 'ui', files: ['src/app.kt', 'coordx:src/z.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } });
    doc.tasks.push({ id: 'T5', title: 'z', wave: 1, files: ['ui:src/app.kt', 'src/contract.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } });
    fs.writeFileSync(pj, JSON.stringify(doc));
    const errs = op.runtimePlanLint(dir, null, {}).errors.join('\n');
    assert.match(errs, /T3: repo "web" não é membro do programa/);
    assert.match(errs, /T5: a tarefa toca mais de um repositório \(\(coordenador\), ui\)/);
    assert.doesNotMatch(errs, /T2:.*repositório/);
  });

  it('the close goes through the members in order: a dirty member stops; the landed shas are recorded and in the dossier', async () => {
    const { dir, ui } = setup();
    // a coordinator-only plan this time: the member's change is committed in the member repo
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'contrato', wave: 1, files: ['src/contract.ts'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
    op.runtimeProgramMember(dir, null, { action: 'add', name: 'ui', path: '../ui' });
    const executor = { async execute(_n, lease) { fs.writeFileSync(path.join(lease.root_path, 'src', 'contract.ts'), 'y\n'); return { success: true, failure_class: null, evidence: ['src/contract.ts'], output: 'ok' }; } };
    await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true });
    await op.runRuntimeVerify(dir, null);
    const d = op.runtimeDossier(dir, null, {});
    const pf = path.join(d.dir, 'plan.md');
    fs.writeFileSync(pf, fs.readFileSync(pf, 'utf8').replace('(preencher antes do `program close`)', 'O contrato está pronto para o app Android.'));
    write(ui, 'src/app.kt', 'fun main() { println() }\n');
    const close = () => op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, commit: false, rollbackCheck: false, defects: false });
    let res = close();
    assert.equal(res.closed, false);
    assert.match(res.gate.reasons.join('\n'), /membros: membro ui \(ordem 1\) tem mudanças não commitadas/);
    git(ui, 'commit', '-qam', 'android');
    const sha = git(ui, 'rev-parse', 'HEAD').stdout.trim();
    res = close();
    assert.equal(res.closed, true, JSON.stringify(res.gate));
    const pg = programLib.readProgram(path.join(dir, '.oxe', 'program'));
    assert.equal(pg.phases[0].members_landed[0].sha, sha);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'dossier', 'F1', 'members.md'), 'utf8'), new RegExp(sha.slice(0, 12)));
  });
});
