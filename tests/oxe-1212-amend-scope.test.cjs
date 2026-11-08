'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-090 (blocked F2): `plan lint` on F2 failed with 14 "A8@v2: emenda sem teste de aceite" for amendments
// (CR-21..32) of criteria of OTHER phases (A8 of F1 closed, A10/A12 of F3 …). F2's own criteria were A48 and A57.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-am-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A8 | f1 | manual |\n| A10 | f3 | manual |\n| A48 | f2 | manual |\n| A57 | f2 b | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], acceptance: ['A48', 'A57'], verify: { commands: ['node -e "process.exit(0)"'] } }] }));
  const ph = (id, acceptance, status, closedAt = null) => ({ id, title: id, requirements: [], acceptance, scope: null, status, plan_ref: null, run_id: null, started_at: 'x', closed_at: closedAt, closed_commit: null, regression_ref: null, interfaces_ref: null });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F2', created_at: 'x', updated_at: 'x', phases: [ph('F1', ['A8'], 'closed', '2026-11-08T06:00:00.000Z'), ph('F2', ['A48', 'A57'], 'executing'), ph('F3', ['A10'], 'pending')] }, null, 2));
  const cr = (id, criteria, at) => JSON.stringify({ kind: 'cr', id, class: 'spec_gap', summary: 'direção do cockpit', criteria, phase: 'F2', by: 'tl', at, status: 'open', amend_to: 2, amendment: 'changing' });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), `${cr('CR-21', ['A8'], '2026-11-08T09:00:00.000Z')}\n${cr('CR-22', ['A10'], '2026-11-08T09:01:00.000Z')}\n`);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('OXB-090: amendment checks only for the active phase criteria', () => {
  it('amendments of other phases are not F2 plan errors; one of F2 still is', () => {
    const dir = project();
    let lint = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(!lint.errors.some((e) => /emenda/.test(e)), lint.errors.join('\n'));
    fs.appendFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), `${JSON.stringify({ kind: 'cr', id: 'CR-23', class: 'spec_gap', summary: 'emenda da F2', criteria: ['A48'], phase: 'F2', by: 'tl', at: '2026-11-08T10:00:00.000Z', status: 'open', amend_to: 2, amendment: 'changing' })}\n`);
    lint = op.runtimePlanLint(dir, null, { preflight: false });
    assert.ok(lint.errors.some((e) => /^A48@v2: emenda sem teste de aceite/.test(e)), lint.errors.join('\n'));
    assert.ok(!lint.errors.some((e) => /^A8@v2|^A10@v2/.test(e)));
  });

  it('program status reports an amendment to a closed phase after its close ("reaberto?")', () => {
    const dir = project();
    const st = op.runtimeProgramStatus(dir, null);
    assert.deepEqual(st.amended_closed, [{ phase: 'F1', criterion: 'A8', version: 2, crs: ['CR-21'] }]);
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'oxe-cc.js'), 'runtime', 'program', 'status', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.match(r.stdout, /F1 fechada com emenda depois do close . reaberto\? A8@v2 \(CR-21\)/);
  });
});
