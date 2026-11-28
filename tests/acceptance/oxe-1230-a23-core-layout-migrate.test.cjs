'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin/oxe-cc.js');
const STATIC_ASSETS = ['workflows', 'templates', 'personas', 'agents', 'schemas', 'install'];

function childEnv() {
  const env = { ...process.env, OXE_NO_PROMPT: '1' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function run(args, expectStatus = 0) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: childEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(res.status, expectStatus, `oxe-cc ${args.join(' ')} saiu ${res.status}\n${res.stdout}\n${res.stderr}`);
  return res;
}

function lastJson(stdout) {
  const start = stdout.indexOf('{');
  assert.ok(start >= 0, `saída sem JSON:\n${stdout}`);
  return JSON.parse(stdout.slice(start));
}

function readConfig(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'config.json'), 'utf8'));
}

describe('A23 — Layout enxuto .oxe/core/, resolução retroativa e doctor --migrate-layout (OXB-230-23)', () => {
  it('OXB-230-23: oxe-cc install --layout core isola os assets estáticos em .oxe/core/ e deixa a raiz .oxe/ com <= 5 entradas', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a23-core-'));
    try {
      run(['install', '--dir', tmp, '--ide-local', '--force', '--layout', 'core']);
      const oxe = path.join(tmp, '.oxe');
      const rootEntries = fs.readdirSync(oxe);
      assert.ok(rootEntries.length <= 5, `raiz .oxe/ com ${rootEntries.length} entradas: ${rootEntries.join(', ')}`);
      for (const kind of STATIC_ASSETS) {
        assert.equal(fs.existsSync(path.join(oxe, kind)), false, `.oxe/${kind} não deve existir na raiz no layout core`);
      }
      assert.ok(fs.existsSync(path.join(oxe, 'core', 'workflows', 'plan.md')), '.oxe/core/workflows/plan.md ausente');
      assert.ok(fs.existsSync(path.join(oxe, 'core', 'workflows', 'lean', 'plan.md')), '.oxe/core/workflows/lean/plan.md ausente');
      assert.ok(fs.existsSync(path.join(oxe, 'core', 'templates')), '.oxe/core/templates ausente');
      assert.equal(readConfig(tmp).install.repo_layout, 'core');

      const wrapper = fs.readFileSync(path.join(tmp, '.cursor', 'commands', 'oxe-plan.md'), 'utf8');
      assert.ok(wrapper.includes('.oxe/core/workflows/plan.md'), 'wrapper instalado não cita .oxe/core/workflows/plan.md na resolução');

      // doctor e status seguem verdes num projeto em layout core
      run(['doctor', '--dir', tmp, '--json']);
      run(['status', '--dir', tmp, '--json']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('OXB-230-23: a resolução .oxe/core/ -> .oxe/ -> oxe/ preserva projetos legados e o config aceita repo_layout "core"', () => {
    const wf = require(path.join(REPO_ROOT, 'bin/lib/oxe-workflows.cjs'));
    const health = require(path.join(REPO_ROOT, 'bin/lib/oxe-project-health.cjs'));
    const semantics = require(path.join(REPO_ROOT, 'bin/lib/oxe-runtime-semantics.cjs'));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a23-resolve-'));
    try {
      const classic = path.join(tmp, 'oxe', 'workflows');
      fs.mkdirSync(classic, { recursive: true });
      assert.equal(wf.resolveWorkflowsDir(tmp), classic);

      const nested = path.join(tmp, '.oxe', 'workflows');
      fs.mkdirSync(nested, { recursive: true });
      assert.equal(wf.resolveWorkflowsDir(tmp), nested);

      const core = path.join(tmp, '.oxe', 'core', 'workflows');
      fs.mkdirSync(core, { recursive: true });
      assert.equal(wf.resolveWorkflowsDir(tmp), core);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    assert.ok(health.INSTALL_REPO_LAYOUTS.includes('core'));
    const shape = health.validateConfigShape({ install: { repo_layout: 'core' } });
    const errors = JSON.stringify(shape);
    assert.equal(errors.includes('repo_layout'), false, `repo_layout "core" rejeitado: ${errors}`);

    const block = semantics.buildWorkflowResolutionBlock('plan');
    const iCore = block.indexOf('.oxe/core/workflows/plan.md');
    const iNested = block.indexOf(' .oxe/workflows/plan.md');
    const iClassic = block.indexOf(' oxe/workflows/plan.md');
    assert.ok(iCore >= 0 && iNested > iCore && iClassic > iNested, `ordem de resolução errada no bloco:\n${block}`);
  });

  it('OXB-230-23: oxe-cc doctor --migrate-layout ensaia sem mexer, --apply move para .oxe/core/ e a segunda execução não tem nada a mover', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a23-migrate-'));
    try {
      run(['install', '--dir', tmp, '--ide-local', '--force']);
      const oxe = path.join(tmp, '.oxe');
      assert.ok(fs.existsSync(path.join(oxe, 'workflows', 'plan.md')), 'pré-condição: install nested com .oxe/workflows');
      fs.writeFileSync(path.join(oxe, 'STATE.md'), '# estado do projeto\n', 'utf8');

      const dry = lastJson(run(['doctor', '--dir', tmp, '--migrate-layout', '--json']).stdout);
      assert.equal(dry.apply, false);
      const dryFrom = dry.moves.map((m) => m.from).sort();
      for (const kind of ['workflows', 'templates']) {
        assert.ok(dryFrom.includes(`.oxe/${kind}`), `ensaio não lista .oxe/${kind}: ${JSON.stringify(dry.moves)}`);
      }
      assert.ok(fs.existsSync(path.join(oxe, 'workflows', 'plan.md')), 'o ensaio não pode mover nada');
      assert.equal(fs.existsSync(path.join(oxe, 'core')), false, 'o ensaio não pode criar .oxe/core');

      const applied = lastJson(run(['doctor', '--dir', tmp, '--migrate-layout', '--apply', '--json']).stdout);
      assert.equal(applied.apply, true);
      assert.equal(applied.ok, true);
      for (const kind of STATIC_ASSETS) {
        assert.equal(fs.existsSync(path.join(oxe, kind)), false, `.oxe/${kind} ficou na raiz depois do --apply`);
      }
      assert.ok(fs.existsSync(path.join(oxe, 'core', 'workflows', 'plan.md')));
      assert.equal(fs.readFileSync(path.join(oxe, 'STATE.md'), 'utf8'), '# estado do projeto\n', 'STATE.md do projeto não pode mudar');
      assert.equal(readConfig(tmp).install.repo_layout, 'core');
      assert.ok(fs.readdirSync(oxe).length <= 5, `raiz .oxe/ com ${fs.readdirSync(oxe).join(', ')}`);

      const wf = require(path.join(REPO_ROOT, 'bin/lib/oxe-workflows.cjs'));
      assert.equal(wf.resolveWorkflowsDir(tmp), path.join(oxe, 'core', 'workflows'));

      const again = lastJson(run(['doctor', '--dir', tmp, '--migrate-layout', '--apply', '--json']).stdout);
      assert.equal(again.ok, true);
      assert.deepEqual(again.moves, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('OXB-230-23: SDK expõe client.gc()/client.resume(), test:sdk-types sem drift e a documentação 1.23.0 cobre o layout core', () => {
    const { createClient } = require(path.join(REPO_ROOT, 'lib/sdk/index.cjs'));
    const client = createClient(REPO_ROOT);
    assert.equal(typeof client.gc, 'function');
    assert.equal(typeof client.resume, 'function');
    const dts = fs.readFileSync(path.join(REPO_ROOT, 'lib/sdk/index.d.ts'), 'utf8');
    assert.match(dts, /gc: \(opts\?/);
    assert.match(dts, /resume: \(opts\?/);
    // 0 drift nas declarações geradas (a mesma checagem do npm run test:sdk-types)
    const check = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/generate-sdk-types.cjs'), '--check'], {
      cwd: REPO_ROOT,
      env: childEnv(),
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(check.status, 0, `test:sdk-types com drift:\n${check.stdout}\n${check.stderr}`);

    const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const changelog = read('CHANGELOG.md');
    const top = changelog.slice(changelog.indexOf('## ['), changelog.indexOf('## [', changelog.indexOf('## [') + 4));
    assert.match(top, /1\.23\.0/);
    assert.ok(top.includes('--layout core'), 'CHANGELOG 1.23.0 sem --layout core');
    assert.ok(top.includes('doctor --migrate-layout'), 'CHANGELOG 1.23.0 sem doctor --migrate-layout');
    assert.ok(read('README.md').includes('--layout core'), 'README sem --layout core');
    assert.ok(read('AGENTS.md').includes('doctor --migrate-layout'), 'AGENTS.md sem doctor --migrate-layout');
    const sdkReadme = read('lib/sdk/README.md');
    assert.ok(sdkReadme.includes('client.gc(') && sdkReadme.includes('client.resume('), 'lib/sdk/README.md sem client.gc()/client.resume()');
    const adr = fs.readdirSync(path.join(REPO_ROOT, 'docs', 'adr')).find((f) => f.startsWith('D-8-'));
    assert.ok(adr, 'ADR D-8 ausente');
    assert.ok(read(path.join('docs', 'adr', adr)).includes('.oxe/core/'), 'ADR D-8 sem a seção do layout .oxe/core/');
  });
});
