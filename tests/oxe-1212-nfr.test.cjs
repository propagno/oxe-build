'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const nfr = require('../bin/lib/oxe-nfr.cjs');

// 1.21.2 — OXB-144: non-functional criteria with measured evidence (median, spread, threshold, regression).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-nfr-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A12 | inicia rápido | nfr |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A12\n\n## Fase 2 — Depois\n\n**Critérios de aceite:** —\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['a.js'], acceptance: ['A12'], verify: { commands: ['node -e 0'] } }] }));
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const seq = (values) => { let i = 0; return () => { const v = values[Math.min(i, values.length - 1)]; i += 1; return v == null ? { ok: false, stdout: 'crash' } : { ok: true, stdout: `boot\nstartup_ms=${v}\n` }; }; };
const pdir = (d) => path.join(d, '.oxe', 'program');

describe('OXB-144: NFR criteria', () => {
  it('parser, median and spread, threshold', () => {
    assert.equal(nfr.parseValue('x\nstartup_ms: 812.5\n', 'startup_ms'), 812.5);
    assert.equal(nfr.parseValue('took 3 runs, 1200 ms', 'other'), 1200);
    assert.deepEqual(nfr.stats([5, 1, 3, 2, 4]), { n: 5, median: 3, min: 1, max: 5, spread: 1.333 });
    assert.throws(() => nfr.parseThreshold('fast'), /threshold inválido/);
  });

  it('a startup criterion with 5 samples passes under the limit and fails over it; missing samples fail', () => {
    const d = project();
    spawnSync(process.execPath, [CLI, 'runtime', 'nfr', 'declare', '--criteria', 'A12', '--metric', 'startup_ms', '--method', 'node boot.js', '--threshold', '<=1500', '--samples', '5', '--dir', d], { encoding: 'utf8' });
    const ok = op.runtimeNfr(d, null, { action: 'measure', criteria: 'A12', run: seq([1200, 1250, 1180, 1300, 1220]) });
    assert.equal(ok.measurement.pass, true);
    assert.equal(ok.measurement.median, 1220);
    const over = op.runtimeNfr(d, null, { action: 'measure', criteria: 'A12', run: seq([1600, 1700, 1650, 1580, 1620]) });
    assert.equal(over.measurement.pass, false);
    assert.match(over.measurement.reason, /fora do limite <=1500/);
    const short = op.runtimeNfr(d, null, { action: 'measure', criteria: 'A12', run: seq([1200, null, 1210, 1220, 1190]) });
    assert.equal(short.measurement.pass, false);
    assert.match(short.measurement.reason, /amostras insuficientes: 4\/5/);
  });

  it('20% worse than the previous phase is a finding even inside the limit; the phase verify gets the nfr gate', () => {
    const d = project();
    nfr.declare(pdir(d), 'A12', { metric: 'startup_ms', method: 'node boot.js', threshold: '<=1500', samples: 3 });
    op.runtimeNfr(d, null, { action: 'measure', criteria: 'A12', phase: 'F1', run: seq([1000]) });
    const f2 = op.runtimeNfr(d, null, { action: 'measure', criteria: 'A12', phase: 'F2', run: seq([1200]) });
    assert.equal(f2.measurement.pass, true);
    assert.equal(f2.measurement.regression.worse_pct, 20);
    assert.match(String(f2.finding), /^CR-/);
    assert.match(fs.readFileSync(path.join(pdir(d), 'changes.ndjson'), 'utf8'), /nfr-regression/);
    assert.match(fs.readFileSync(path.join(d, '.oxe', 'dossier', 'F2', 'nfr.md'), 'utf8'), /\| F2 \| 1200 .*regressão 20% vs F1/);
    const gates = op.implicitPhaseGates(d, require('../bin/lib/oxe-program.cjs').readProgram(pdir(d)), 'F1', { stub_check: false });
    assert.ok(gates.some((g) => g.id === 'nfr-A12' && /runtime nfr measure --criteria A12 --phase F1/.test(g.command)));
  });
});
