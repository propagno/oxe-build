'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const rr = require('../bin/lib/oxe-real-regression.cjs');

// 1.21.2 — OXB-101: regression over real program snapshots (kept outside the repo): lint, compile, dossier, close dry-run.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

function program() {
  const dir = tmp('oxe-1212-rr-p-');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, '.oxe/runs/r1.json', '{"big":"run state that must not be copied"}');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}

describe('OXB-101: real program regression', () => {
  it('snapshot copies only the .oxe core and only to a folder outside the repo', () => {
    const p = program();
    assert.throws(() => rr.snapshot(p, path.join(p, 'fixtures'), 'f1'), /FORA do repositório/);
    const fx = tmp('oxe-1212-rr-fx-');
    const out = rr.snapshot(p, fx, 'f1');
    assert.ok(out.copied.includes('PLAN.json') && out.copied.includes('program'));
    assert.ok(!fs.existsSync(path.join(fx, 'f1', '.oxe', 'runs')), 'runs/ is not part of a snapshot');
  });

  it('regress creates the baseline, then a regression in any step is reported; --update accepts it', () => {
    const p = program();
    const fx = tmp('oxe-1212-rr-fx-');
    rr.snapshot(p, fx, 'f1');
    const first = spawnSync(process.execPath, [CLI, 'program', 'regress', '--fixtures', fx, '--dir', p], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /baseline criada/);
    const again = rr.regress(fx, op);
    assert.equal(again.ok, true, JSON.stringify(again.results));
    const steps = again.results[0].got.steps;
    assert.deepEqual(steps.map((s) => [s.step, s.ok]), [['plan lint', true], ['compile', true], ['dossier', true], ['close dry-run', true]]);
    // a snapshot that now produces a lint error (simulating a CLI change that breaks real plans)
    const pj = path.join(fx, 'f1', '.oxe', 'PLAN.json');
    const doc = JSON.parse(fs.readFileSync(pj, 'utf8'));
    doc.tasks[0].depends_on = ['T9'];
    fs.writeFileSync(pj, JSON.stringify(doc));
    const bad = rr.regress(fx, op);
    assert.equal(bad.ok, false);
    assert.match(bad.results[0].regressions.join('\n'), /plan lint: errors \d+ → \d+/);
    assert.equal(rr.regress(fx, op, { update: true }).ok, true);
  });
});
