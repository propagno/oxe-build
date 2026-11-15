'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// OxeSpace 15/11 (user decision ~18:00Z): no final phase verify — `program close --by-ci` closes on the green CI
// attached to the phase (its PRs' runs or the main run that contains it). Only the verify requirement is replaced.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-byci-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ external_dependency_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'ui', wave: 1, files: ['src/ui.ts'], acceptance: ['A1'], done: true }] }));
  write(dir, 'src/ui.ts', 'export {};\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const gh = (data) => () => ({ status: 0, stdout: JSON.stringify({ status: 'completed', conclusion: 'success', url: 'https://x/actions/runs/9', ...data }), stderr: '' });
const close = (dir, extra = {}) => op.runtimeProgramClose(dir, null, { phase: 'F1', gates: false, dossier: false, commit: false, defects: false, rollbackCheck: false, ...extra });
const attach = (dir, run) => require('../bin/lib/oxe-phase-gates.cjs').attachCiRun(path.join(dir, '.oxe', 'program'), { run: String(run), phase: 'F1' });

describe('program close --by-ci', () => {
  it('without a phase verify the close fails; --by-ci with a green run that contains HEAD closes, recorded', () => {
    const dir = project();
    const plain = close(dir);
    assert.equal(plain.closed, false);
    assert.match(plain.gate.reasons.join('\n'), /verify não concluído/);
    assert.throws(() => close(dir, { byCi: true }), /--by-ci exige --by/);
    const head = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    attach(dir, 9);
    const out = close(dir, { byCi: true, by: 'tech-lead', reason: 'decisão do usuário 15/11: CI verde fecha a fase', ghSpawn: gh({ headSha: head }) });
    assert.equal(out.closed, true, JSON.stringify(out.gate && out.gate.reasons));
    assert.equal(out.close_by_ci.run, '9');
    assert.equal(out.close_by_ci.head, head);
    const ch = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(ch.some((c) => c.kind === 'close_by_ci' && c.phase === 'F1' && c.by === 'tech-lead'));
  });

  it('no attached run, a red run, or a green run of older code does not close', () => {
    const dir = project();
    const opts = { byCi: true, by: 'tl', reason: 'decisão do usuário 15/11' };
    assert.match(close(dir, { ...opts, ghSpawn: gh({}) }).gate.reasons.join('\n'), /nenhum run de CI anexado à fase F1/);
    const old = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    write(dir, 'src/ui.ts', 'export const x = 1;\n'); git(dir, 'commit', '-qam', 'code after the run');
    attach(dir, 10);
    assert.match(close(dir, { ...opts, ghSpawn: gh({ headSha: old }) }).gate.reasons.join('\n'), /verde, mas não contém HEAD/);
    assert.match(close(dir, { ...opts, ghSpawn: gh({ headSha: old, conclusion: 'failure' }) }).gate.reasons.join('\n'), /terminou failure/);
    // only docs after the run: the same code
    const codeHead = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    write(dir, 'docs/n.md', 'x\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'docs');
    assert.equal(close(dir, { ...opts, ghSpawn: gh({ headSha: codeHead }) }).closed, true);
  });
});
