'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const gates = require('../bin/lib/oxe-phase-gates.cjs');

// 1.21.2 — OXB-107: gates as config plugins — command, ci, deploy, signoff, script, and plugin kinds.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const run = (cmd, cwd) => spawnSync(cmd, { shell: true, cwd, encoding: 'utf8' });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-gp-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  write(dir, 'gates/bundle-size.cjs', "module.exports = async (ctx) => { const max = ctx.gate.options.max_kb; const kb = 900; return { ok: kb <= max, message: `bundle ${kb} KB (máx ${max}) na ${ctx.phase}` }; };\n");
  return dir;
}

describe('OXB-107: gate plugins', () => {
  it('a plugin kind from config gate_plugins runs its module with options; red and green', () => {
    const dir = project();
    const cfg = { gate_plugins: { 'bundle-size': 'gates/bundle-size.cjs' }, phase_gates: [{ id: 'bundle', kind: 'bundle-size', options: { max_kb: 1000 } }, { id: 'bundle-strict', kind: 'bundle-size', options: { max_kb: 500 } }] };
    const g = gates.readPhaseGates({}, cfg);
    assert.deepEqual(g.map((x) => [x.id, x.kind, x.plugin]), [['bundle', 'script', 'bundle-size'], ['bundle-strict', 'script', 'bundle-size']]);
    const checks = gates.gateChecks(g, 'phase_verify', { programDir: path.join(dir, '.oxe', 'program'), phase: 'F2' });
    const ok = run(checks[0].command, dir);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /bundle 900 KB \(máx 1000\) na F2/);
    const bad = run(checks[1].command, dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /máx 500/);
  });

  it('a signoff gate is green only with a sign-off with evidence of each criterion in the phase', () => {
    const dir = project();
    const [g] = gates.readPhaseGates({ phase_gates: [{ id: 'po', kind: 'signoff', criteria: ['A40', 'a41'] }] }, {});
    assert.equal(g.when, 'program_close');
    const cmd = gates.gateChecks([g], 'program_close', { programDir: path.join(dir, '.oxe', 'program'), phase: 'F1' })[0].command;
    assert.equal(run(cmd, dir).status, 1);
    fs.writeFileSync(path.join(dir, '.oxe', 'program', 'signoffs.ndjson'), `${JSON.stringify({ phase: 'F1', criteria: ['A40', 'A41'], by: 'po', evidence: 'docs/uat.md' })}\n`);
    assert.equal(run(cmd, dir).status, 0);
  });

  it('an unknown kind without a plugin is dropped and the lint says so; command/ci/deploy unchanged', () => {
    const plan = { phase_gates: [{ id: 'x', kind: 'perf' }, { id: 'tc', command: 'npm run typecheck' }] };
    assert.deepEqual(gates.readPhaseGates(plan, {}).map((g) => g.id), ['tc']);
    assert.match(gates.unknownGateKinds(plan, {})[0], /gate x: kind "perf" não é nativo/);
    assert.deepEqual(gates.unknownGateKinds(plan, { gate_plugins: { perf: 'g.cjs' } }), []);
    assert.equal(gates.readPhaseGates({ phase_gates: [{ id: 'ci', kind: 'ci' }] }, {})[0].kind, 'ci');
  });
});
