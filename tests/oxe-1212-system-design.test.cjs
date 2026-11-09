'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const sd = require('../bin/lib/oxe-system-design.cjs');

// 1.21.2 — OXB-104 (SYSTEM-DESIGN artifact) and OXB-105 (design drift gate at the close).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-sd-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n| R-ID | Requisito | Versão | Critério de aceite |\n|---|---|---|---|\n| R1 | A queue sincroniza com o celular | v1 | A1 — teste |\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | sincroniza | t |\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, 'src/queue/a.ts', '1\n'); write(dir, 'src/queue/b.ts', '1\n');
  write(dir, 'src/ui/x.tsx', '1\n'); write(dir, 'src/ui/y.tsx', '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  require('../bin/lib/oxe-decisions.cjs').add(path.join(dir, '.oxe', 'program'), { title: 'A fila fica no SQLite', by: 'tl', criteria: ['A1'], alternatives: ['JSON local::corrompe'] });
  return dir;
}

describe('OXB-104: SYSTEM-DESIGN', () => {
  it('design build: components by source dir linked to R/A, flows per requirement, ADR from decisions, Mermaid C4 and sequences; prose kept on rebuild', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [CLI, 'design', 'build', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    let text = fs.readFileSync(sd.FILE(dir), 'utf8');
    assert.match(text, /<!-- oxe-design: id=component\/src\/queue paths=src\/queue\/\*\* ids=R1,A1 -->/);
    assert.match(text, /<!-- oxe-design: id=flow\/R1 paths= ids=R1,A1 -->/);
    assert.match(text, /D-1 — A fila fica no SQLite[\s\S]*Alternativa recusada:\*\* JSON local/);
    assert.match(text, /```mermaid\nflowchart LR/);
    assert.match(text, /sequenceDiagram/);
    text = text.replace(/_Responsabilidade, interfaces e dependências de `src\/queue`[^\n]*/, 'A fila guarda e drena tarefas (escrito à mão).');
    fs.writeFileSync(sd.FILE(dir), text);
    op.runtimeDesignBuild(dir, null);
    assert.match(fs.readFileSync(sd.FILE(dir), 'utf8'), /A fila guarda e drena tarefas \(escrito à mão\)\./);
  });
});

describe('OXB-105: design drift', () => {
  it('a phase diff on a described path with the document unchanged is stale; touching the document clears it; the delta lists the sections', () => {
    const dir = project();
    op.runtimeDesignBuild(dir, null);
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const since = new Date(Date.now() + 1000).toISOString();
    write(dir, 'src/queue/a.ts', '2\n');
    git(dir, 'commit', '-qam', 'muda a fila');
    const st = sd.staleSections(dir, base, { since });
    assert.deepEqual(st.stale.map((s) => s.section), ['component/src/queue']);
    assert.deepEqual(st.stale[0].files, ['src/queue/a.ts']);
    assert.deepEqual(sd.staleSections(dir, base, { designChanged: true }).stale, []);
    const delta = sd.deltaEntry(dir, 'F1', base);
    assert.deepEqual(delta.sections, ['component/src/queue']);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'CODEBASE-DELTA.md'), 'utf8'), /close da F1[\s\S]*component\/src\/queue/);
  });
});
