'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-124: a sign-off is pinned to the commit it judged and to the criterion text.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const SPEC = (a70) => `# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A70 | ${a70} | sign-off |\n`;

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-vh-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', SPEC('interface sem erros'));
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false, program: { standing_acceptance: ['A70'] } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'ui', wave: 1, files: ['src/ui.tsx'], acceptance: ['A1', 'A70'], done: true }] }));
  write(dir, 'src/ui.tsx', 'export {};\n');
  write(dir, 'docs/notes.md', 'x\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const closeReasons = (dir) => { try { const r = op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false }); return ((r.gate && r.gate.reasons) || []).join('\n'); } catch (e) { return e.message; } };
const signoff = (dir) => op.runtimeSignoff(dir, null, { phase: 'F1', criteria: 'A70', by: 'ux', evidence: 'relatorio.md' });

describe('OXB-124: verdicts pinned to head and criterion version', () => {
  it('the sign-off records head and the criterion version', () => {
    const dir = project();
    const r = signoff(dir);
    assert.equal(r.head, git(dir, 'rev-parse', 'HEAD').stdout.trim());
    assert.match(r.criteria_versions.A70, /^[0-9a-f]{16}$/);
    assert.doesNotMatch(closeReasons(dir), /stale_verdict|critério permanente A70/);
  });

  it('a commit touching the criterion scope after the sign-off makes it stale', () => {
    const dir = project();
    signoff(dir);
    write(dir, 'src/ui.tsx', 'export const x = 1;\n'); git(dir, 'commit', '-qam', 'ui change');
    const r = closeReasons(dir);
    assert.match(r, /stale_verdict: sign-off de A70 por ux — commit novo no escopo de A70/);
    assert.match(r, /critério permanente A70: falta o sign-off/);
  });

  it('a commit only in docs/ (outside the scope) keeps it fresh', () => {
    const dir = project();
    signoff(dir);
    write(dir, 'docs/notes.md', 'y\n'); git(dir, 'commit', '-qam', 'docs');
    assert.doesNotMatch(closeReasons(dir), /stale_verdict/);
  });

  it('an amended criterion makes it stale; an old sign-off without head is stale with a migration message', () => {
    const dir = project();
    signoff(dir);
    write(dir, '.oxe/SPEC.md', SPEC('interface sem erros, com foco visível em todos os controles'));
    assert.match(closeReasons(dir), /stale_verdict: .*A70 foi emendado depois do sign-off/);
    const old = project();
    fs.appendFileSync(path.join(old, '.oxe', 'program', 'signoffs.ndjson'), JSON.stringify({ phase: 'F1', criteria: ['A70'], by: 'ux', at: '2026-11-01', evidence: 'x' }) + '\n');
    assert.match(closeReasons(old), /stale_verdict: .*sem head \(gravado antes da 1\.21\.2\)/);
  });
});
