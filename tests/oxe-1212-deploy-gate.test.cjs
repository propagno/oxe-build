'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const gates = require('../bin/lib/oxe-phase-gates.cjs');

// 1.21.2 — OXB-093: the OXESpace 1.5.0 release (F11) is a deploy — tag → release workflow → GitHub release → APK — with
// post-deploy checks (install-over from 1.4.3, HML's packaged pass, upgrade-with-data). oxe-build stopped at the PR.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dep-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  const phase = { id: 'F11', title: 'Release', requirements: [], acceptance: ['A40'], scope: null, status: 'verifying', plan_ref: null, run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null };
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F11', created_at: 'x', updated_at: 'x', phases: [phase] }));
  fs.writeFileSync(path.join(dir, 'install-over.js'), "process.exit(require('fs').existsSync('installed.flag') ? 0 : 1);\n");
  return dir;
}
const programDir = (dir) => path.join(dir, '.oxe', 'program');

describe('OXB-093: deploy attached as phase evidence, never performed', () => {
  it('attach records env/version/ref and each check with id, exit and time; a red check makes the record not ok', () => {
    const dir = project();
    const rec = op.runtimeDeployAttach(dir, null, { env: 'github-release', version: '1.5.0', ref: 'https://github.com/o/r/releases/tag/v1.5.0', checks: ['node install-over.js', 'node -e "process.exit(0)"'], by: 'tl' });
    assert.equal(rec.phase, 'F11');
    assert.equal(rec.ok, false);
    assert.deepEqual(rec.checks.map((c) => [c.command, c.exit, c.ok]), [['node install-over.js', 1, false], ['node -e "process.exit(0)"', 0, true]]);
    assert.ok(rec.checks.every((c) => /^chk-/.test(c.id) && c.at));
    const line = fs.readFileSync(path.join(programDir(dir), 'deploy.ndjson'), 'utf8').trim().split('\n').pop();
    assert.equal(JSON.parse(line).ref, 'https://github.com/o/r/releases/tag/v1.5.0');
  });

  it('refuses a --check that would perform the deploy (tag, release, publish, workflow run)', () => {
    const dir = project();
    for (const cmd of ['git tag v1.5.0', 'gh release create v1.5.0', 'npm publish', 'node scripts/release.mjs', 'gh workflow run release.yml']) {
      assert.throws(() => op.runtimeDeployAttach(dir, null, { env: 'prod', version: '1', checks: [cmd] }), /nunca o deploy: recusado/, cmd);
    }
    assert.ok(!fs.existsSync(path.join(programDir(dir), 'deploy.ndjson')), 'nothing recorded');
  });

  it('a deploy gate: red without a deploy, red with a red or missing required check, green when all ran green (later attach counts)', () => {
    const dir = project();
    const gate = gates.normalizeGate({ id: 'release', kind: 'deploy', env: 'github-release', version: '1.5.0', checks: ['install-over', 'hml-packaged'] });
    assert.equal(gate.when, 'program_close');
    assert.match(gates.deployGateStatus(programDir(dir), 'F11', gate).message, /nenhum deploy em github-release 1\.5\.0/);
    op.runtimeDeployAttach(dir, null, { env: 'github-release', version: '1.5.0', checks: ['node install-over.js'] });
    assert.match(gates.deployGateStatus(programDir(dir), 'F11', gate).message, /check vermelho/);
    fs.writeFileSync(path.join(dir, 'installed.flag'), 'x');
    op.runtimeDeployAttach(dir, null, { env: 'github-release', version: '1.5.0', checks: ['node install-over.js'] });
    assert.match(gates.deployGateStatus(programDir(dir), 'F11', gate).message, /checks exigidos não rodados — hml-packaged/);
    op.runtimeDeployAttach(dir, null, { env: 'github-release', version: '1.5.0', checks: ['node -e "process.exit(0)" hml-packaged'] });
    assert.equal(gates.deployGateStatus(programDir(dir), 'F11', gate).ok, true);
    // The gate command (what the close runs) agrees.
    const cmd = gates.gateCommand(gate, { programDir: programDir(dir), phase: 'F11' });
    assert.equal(spawnSync(cmd, { shell: true, encoding: 'utf8' }).status, 0);
  });

  it('program close is blocked by a deploy gate without the deploy; the CLI attaches and exits 1 on a red check', () => {
    const dir = project({ phase_gates: [{ id: 'release', kind: 'deploy', env: 'github-release', version: '1.5.0' }] });
    const closed = op.runtimeProgramClose(dir, null, { dossier: false, runState: { status: 'completed', verification_check_results: [{ check_id: 'c', status: 'pass' }] } });
    assert.ok((closed.gate.reasons || []).some((r) => /gate do projeto vermelho no close: release/.test(r)), JSON.stringify(closed.gate));
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'deploy', '--attach', 'github-release', '--version', '1.5.0', '--ref', 'v1.5.0', '--check', 'node install-over.js', '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stdout, /deploy github-release 1\.5\.0 anexado à fase F11/);
  });
});

describe('OXB-093: deploy evidence in the dossier', () => {
  it('the phase dossier gets deploy.md with env, version, ref and each check', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    op.runtimeDeployAttach(dir, null, { env: 'github-release', version: '1.5.0', ref: 'v1.5.0', checks: ['node -e 0'] });
    op.runtimeDossier(dir, null, { phase: 'F11', runState: { run_id: 'r', status: 'completed' } });
    const md = fs.readFileSync(path.join(dir, '.oxe', 'dossier', 'F11', 'deploy.md'), 'utf8');
    assert.match(md, /## github-release · 1\.5\.0 — verificado/);
    assert.match(md, /\*\*Ref:\*\* v1\.5\.0/);
    assert.match(md, /\| chk-[a-z0-9]+-1 \| `node -e 0` \| 0 \|/);
  });
});
