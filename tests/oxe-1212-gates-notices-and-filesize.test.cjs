'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const pb = require('../bin/lib/oxe-plan-build.cjs');
const ic = require('../bin/lib/oxe-integration-checks.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-202: F2 removed production packages and THIRD_PARTY_NOTICES.md went stale (CI notices:check red);
// merging F2 + F3 summed lines over the scripts/check-file-size.mjs cap. Every per-phase gate was green.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2)); };

// a size checker with a 3-line cap on src/App.tsx, and a notices checker comparing package.json deps with the notices
const SIZE = "const fs=require('fs');const n=fs.readFileSync('src/App.tsx','utf8').split('\\n').filter(Boolean).length;if(n>3){console.error('src/App.tsx: '+n+' linhas > teto 3');process.exit(1)}\n";
const NOTICES = "const fs=require('fs');const d=Object.keys(JSON.parse(fs.readFileSync('package.json','utf8')).dependencies||{});const t=fs.readFileSync('THIRD_PARTY_NOTICES.md','utf8');const miss=d.filter(x=>!t.includes(x));const extra=(t.match(/^- (\\S+)/gm)||[]).map(l=>l.slice(2)).filter(x=>!d.includes(x));if(miss.length||extra.length){console.error('notices defasado: '+[...miss,...extra].join(','));process.exit(1)}\n";

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-notices-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/config.json', '{}');
  write(dir, 'package.json', { name: 'x', version: '1.0.0', dependencies: { leftpad: '1.0.0', oldlib: '1.0.0' }, scripts: { 'notices:check': 'node scripts/notices.cjs' } });
  write(dir, 'THIRD_PARTY_NOTICES.md', '# Notices\n\n- leftpad\n- oldlib\n');
  write(dir, 'scripts/notices.cjs', NOTICES);
  write(dir, 'scripts/check-file-size.mjs', SIZE.replace("const fs=require('fs');", "import fs from 'fs';"));
  write(dir, 'src/App.tsx', 'a\nb\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}

describe('OXB-202: notices gate in plan build', () => {
  it('a task editing package.json injects the notices phase gate and THIRD_PARTY_NOTICES.md into its scope', () => {
    const dir = repo();
    const doc = { role: 'backend', tasks: [
      { rid: 'R1', title: 'remover oldlib', files: ['package.json', 'package-lock.json'], edited: ['package.json'], acceptance: ['A1'], verify: { commands: ['node -e 1'] } },
      { rid: 'R2', title: 'outra', files: ['src/App.tsx'], edited: ['src/App.tsx'], acceptance: ['A2'], verify: { commands: ['node -e 1'] } },
    ] };
    const res = pb.build([{ file: 'backend.json', doc }], { root: dir });
    assert.deepEqual(res.errors, []);
    const t1 = res.plan.tasks.find((t) => t.rid === 'R1');
    const t2 = res.plan.tasks.find((t) => t.rid === 'R2');
    assert.ok(t1.files.includes('THIRD_PARTY_NOTICES.md'));
    assert.ok(!t2.files.includes('THIRD_PARTY_NOTICES.md'));
    assert.deepEqual(res.plan.phase_gates.map((g) => [g.id, g.command]), [['notices', 'npm run notices:check']]);
    assert.equal(res.notices_gate, 'notices');
    assert.deepEqual(require('../bin/lib/oxe-plan-json.cjs').validatePlanJson(res.plan), []);
    assert.equal(require('../bin/lib/oxe-phase-gates.cjs').readPhaseGates(res.plan, {})[0].command, 'npm run notices:check');
  });

  it('no package.json change → no gate; an existing notices gate is not duplicated', () => {
    const dir = repo();
    const res = pb.build([{ file: 'b.json', doc: { tasks: [{ rid: 'R1', title: 'ui', files: ['src/App.tsx'], verify: { commands: ['node -e 1'] } }] } }], { root: dir });
    assert.equal(res.plan.phase_gates, undefined);
    const plan = { tasks: [{ id: 'T1', files: ['package.json'] }], phase_gates: [{ id: 'notices', command: 'npm run notices:check' }] };
    pb.injectNoticesGate(dir, 'HEAD', plan, []);
    assert.equal(plan.phase_gates.length, 1);
  });
});

describe('OXB-202: integration checks at the merge wave', () => {
  it('detects check-file-size.mjs and notices:check; config false / list override', () => {
    const dir = repo();
    assert.deepEqual(ic.integrationCommands(dir), ['node scripts/check-file-size.mjs', 'npm run notices:check']);
    assert.deepEqual(ic.integrationCommands(dir, { integration_checks: false }), []);
    assert.deepEqual(ic.integrationCommands(dir, { integration_checks: ['node x.mjs'] }), ['node x.mjs']);
    assert.equal(ic.runIntegrationChecks(dir).ok, true);
  });

  it('runtime sync: two branches sum lines over the size cap → the merge reports the red check before any push', () => {
    const dir = repo();
    git(dir, 'checkout', '-qb', 'f3');
    write(dir, 'src/App.tsx', 'a\nb\nf3\n');
    git(dir, 'commit', '-qam', 'f3 +1');
    git(dir, 'checkout', '-q', '-');
    git(dir, 'checkout', '-qb', 'program');
    write(dir, 'src/App.tsx', 'f2\na\nb\n');
    git(dir, 'commit', '-qam', 'f2 +1');
    const out = op.runtimeSync(dir, null, { from: 'f3', fetch: false, verify: false });
    assert.equal(out.merged, true, out.error);
    assert.equal(out.integration_checks[0].command, 'node scripts/check-file-size.mjs');
    assert.equal(out.integration_checks[0].ok, false);
    assert.match(out.error, /check de integração vermelho depois do merge de f3: `node scripts\/check-file-size\.mjs`/);
    assert.match(out.integration_checks[0].tail, /src\/App\.tsx: 4 linhas > teto 3/);
  });

  it('a stale THIRD_PARTY_NOTICES.md is red', () => {
    const dir = repo();
    write(dir, 'package.json', { name: 'x', version: '1.0.0', dependencies: { leftpad: '1.0.0' }, scripts: { 'notices:check': 'node scripts/notices.cjs' } });
    const out = ic.runIntegrationChecks(dir);
    assert.equal(out.ok, false);
    assert.equal(out.failed.command, 'npm run notices:check');
    assert.match(out.failed.tail, /notices defasado: oldlib/);
  });
});
