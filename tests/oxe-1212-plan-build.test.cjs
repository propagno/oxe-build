'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const pb = require('../bin/lib/oxe-plan-build.cjs');

// 1.21.2 — OXB-097 (plan build), OXB-098 (plan check-role), OXB-106 (declarative task kinds).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2)); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-pb-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | t |\n| A2 | b | t |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1, A2\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, 'src/queue.ts', 'export function enqueue() {}\nexport function drain() {}\n');
  write(dir, 'src/old.ts', 'export const legacy = 1\n');
  write(dir, 'src/shared.ts', 'export const x = 1\n');
  write(dir, 'tests/acceptance/queue.test.ts', "import { enqueue, drain } from '../../src/queue';\nimport { describe, it } from 'vitest';\ndescribe('fila', () => { it('enfileira e drena', () => {}); });\n");
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  write(dir, 'roles/backend.json', { role: 'backend', tasks: [
    { rid: 'R1', title: 'fila', files: ['src/queue.ts', 'tests/acceptance/queue.test.ts', 'src/shared.ts'], edited: ['src/queue.ts'], acceptance: ['A1'], verify: { commands: ['npx vitest run tests/queue'] } },
    { rid: 'R2', title: 'remover legado', kind: 'remove', deleted: ['src/old.ts'], files: ['src/shared.ts'], acceptance: ['A2'], verify: { commands: ['npx vitest run tests/legacy'] } },
  ], acceptance_tests: [{ criterion: 'A1', files: ['tests/acceptance/queue.test.ts'], command: 'npx vitest run tests/acceptance/queue.test.ts', proves: ['enfileira e drena'] }] });
  write(dir, 'roles/frontend.json', { role: 'frontend', tasks: [{ rid: 'R1', title: 'fila', files: ['src/ui/Queue.tsx'], created: ['src/ui/Queue.tsx'], acceptance: ['A1'], verify: { commands: ['npx vitest run tests/ui'] } }] });
  return dir;
}

describe('OXB-097: plan build', () => {
  it('writes PLAN.json, PLAN.md and the pack together with the phase; hot file serializes; frozen tests out of scope; symbols from the test imports', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [CLI, 'plan', 'build', '--from', 'roles/backend.json', 'roles/frontend.json', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const pack = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    const md = fs.readFileSync(path.join(dir, '.oxe', 'PLAN.md'), 'utf8');
    assert.equal(plan.phase, 'F1');
    assert.equal(pack.phase, 'F1');
    assert.match(md, /# PLAN — F1/);
    const [t1, t2] = plan.tasks;
    assert.ok(!t1.files.includes('tests/acceptance/queue.test.ts'), 'frozen acceptance file out of scope');
    assert.ok(t1.files.includes('src/ui/Queue.tsx') && t1.files.includes('src/queue.ts'));
    assert.notEqual(t1.wave, t2.wave, 'src/shared.ts is written by both → different waves');
    const p1 = pack.tasks.find((x) => x.id === t1.id);
    assert.deepEqual(p1.symbols.map((s) => s.name).sort(), ['drain', 'enqueue']);
    assert.ok(p1.contracts.includes('enqueue exportado de src/queue.ts'));
    const p2 = pack.tasks.find((x) => x.id === t2.id);
    assert.deepEqual(p2.removed_paths, ['src/old.ts']);
    assert.ok(p2.contracts.includes('src/old.ts não existe mais'));
    const gaps = pack.tasks.flatMap((x) => require('../bin/lib/oxe-rationality.cjs').validatePackTask(x).gaps);
    assert.deepEqual(gaps, ['IMPLEMENTATION-PACK.json tarefa T2 sem symbols (escreve arquivo de código: src/shared.ts)'], 'only the edited file no frozen test imports');
    assert.match(r.stdout, /T2: nenhum símbolo saiu dos testes congelados para src\/shared\.ts/);
  });
});

describe('OXB-098: plan check-role', () => {
  it('exact proves titles, prose criteria, deleted/edited existing at the ref, created not existing, verify shape', () => {
    const dir = project();
    write(dir, 'roles/bad.json', { role: 'x', tasks: [{ rid: 'R9', title: 'x', criteria: ['a fila funciona'], deleted: ['src/nao-existe.ts'], created: ['src/queue.ts'], verify: { commands: ['npm test -- ...'] }, proves: { 'tests/acceptance/queue.test.ts': ['enfileira e drena', 'titulo inventado'] } }] });
    const r = spawnSync(process.execPath, [CLI, 'plan', 'check-role', 'roles/bad.json', '--ref', 'HEAD', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /critério em prosa "a fila funciona"/);
    assert.match(r.stdout, /src\/nao-existe\.ts não existe em HEAD/);
    assert.match(r.stdout, /src\/queue\.ts já existe em HEAD/);
    assert.match(r.stdout, /não é um comando executável/);
    assert.match(r.stdout, /"titulo inventado" não está em tests\/acceptance\/queue\.test\.ts/);
    assert.doesNotMatch(r.stdout, /"enfileira e drena" não está/);
    const ok = spawnSync(process.execPath, [CLI, 'plan', 'check-role', 'roles/backend.json', '--dir', dir], { cwd: dir, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout);
  });
});

describe('OXB-106: declarative task kinds', () => {
  it('test-only, config-only, add and move have their own rule', () => {
    const info = (kind, exact, extra = {}) => ({ kind, exact, deleted: [], moves: [], ...extra });
    assert.match(pb.kindErrors({ id: 'T1' }, info('test-only', ['tests/a.test.ts', 'src/a.ts']))[0], /src\/a\.ts não é arquivo de teste/);
    assert.deepEqual(pb.kindErrors({ id: 'T1' }, info('test-only', ['tests/a.test.ts'])), []);
    assert.match(pb.kindErrors({ id: 'T2' }, info('config-only', ['package.json', 'src/a.ts']))[0], /não é configuração/);
    assert.match(pb.kindErrors({ id: 'T3' }, info('add', ['src/n.ts'], { deleted: ['src/o.ts'] }))[0], /use remove ou move/);
    assert.match(pb.kindErrors({ id: 'T4' }, info('move', ['src/a.ts']))[0], /declare moves/);
  });
});
