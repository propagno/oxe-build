'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');
const ONBOARD_MOD = path.join(REPO_ROOT, 'bin', 'lib', 'oxe-onboard.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function listFilesRecursive(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listFilesRecursive(path.join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

describe('A12 — OXB-222-12: Agnostic read-only oxe-cc onboard (multi-CI, multi-ALM, multi-stack)', () => {
  it('OXB-222-12: detects GitHub Actions + Jira with CI-vs-phase_gates gap analysis without leaking secrets', () => {
    const onboard = require(ONBOARD_MOD);
    const dir = mkDir('oxe-1222-a12-gh-jira-');
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'gh-jira-app',
      engines: { node: '>=18.0.0' },
      scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run', build: 'vite build' },
    }, null, 2));
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), [
      'name: CI',
      'on: [pull_request, push]',
      'jobs:',
      '  validate:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: npm run typecheck',
      '      - run: npm run lint',
      '      - run: npm test',
      '      - run: npm run build',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
      profile: 'lean',
      stripEnvPrefixes: ['MYAPP_'],
      phase_gates: [{ id: 'lint', command: 'npm run lint' }],
      alm: {
        provider: 'jira',
        transport: 'rest',
        jira: { project: 'APP', site: 'https://app.atlassian.net' },
        states: { in_progress: 'In Progress', released: 'Done' },
        track: ['in_progress'],
      },
    }, null, 2));

    const fakeEnv = {
      PATH: process.env.PATH || '',
      JIRA_SITE: 'https://app.atlassian.net',
      JIRA_EMAIL: 'dev@example.com',
      JIRA_API_TOKEN: 'SUPER_SECRET_TOKEN_VALUE_999',
      MYAPP_SECRET_KEY: 'TOP_SECRET_LEAK_888',
    };

    const pack = onboard.buildOnboardingPack(dir, { env: fakeEnv, nativeCheck: false });
    assert.equal(pack.ok, true);
    assert.equal(pack.read_only, true);
    assert.ok(pack.ci.providers.includes('github-actions'), `expected github-actions: ${JSON.stringify(pack.ci)}`);
    assert.ok(pack.ci.pipelines.some((p) => p.file === '.github/workflows/ci.yml'));
    assert.ok(pack.ci.commands.includes('npm run typecheck'));
    assert.ok(pack.ci.commands.includes('npm run lint'));
    assert.ok(pack.ci.unmirrored_commands.includes('npm run typecheck'), `typecheck must appear as unmirrored CI gap: ${JSON.stringify(pack.ci)}`);
    assert.ok(!pack.ci.unmirrored_commands.includes('npm run lint'), `lint is already mirrored in phase_gates: ${JSON.stringify(pack.ci)}`);
    assert.equal(pack.alm.provider, 'jira');
    assert.equal(pack.alm.configured, true);
    assert.equal(pack.alm.transport, 'rest');
    assert.equal(pack.alm.project, 'APP');
    assert.ok(pack.environment.leaked_env.includes('MYAPP_SECRET_KEY'));
    assert.ok(pack.project.stacks.includes('node'));

    const serialized = JSON.stringify(pack);
    assert.ok(!serialized.includes('SUPER_SECRET_TOKEN_VALUE_999'), 'must NEVER leak secret token value');
    assert.ok(!serialized.includes('TOP_SECRET_LEAK_888'), 'must NEVER leak env var value');
    assert.ok(!pack.prompt_markdown.includes('SUPER_SECRET_TOKEN_VALUE_999'));
    assert.ok(!pack.prompt_markdown.includes('TOP_SECRET_LEAK_888'));
  });

  it('OXB-222-12: adapts agnostically to GitLab CI + Azure DevOps (Go) and Azure Pipelines + no ALM (Python)', () => {
    const onboard = require(ONBOARD_MOD);

    // 1. GitLab CI + Azure DevOps + Go
    const glDir = mkDir('oxe-1222-a12-gitlab-ado-');
    fs.mkdirSync(path.join(glDir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(glDir, 'go.mod'), 'module example.com/svc\n\ngo 1.22\n');
    fs.writeFileSync(path.join(glDir, '.gitlab-ci.yml'), [
      'stages:',
      '  - test',
      '  - build',
      'unit_tests:',
      '  stage: test',
      '  script:',
      '    - go test ./...',
      '    - go vet ./...',
    ].join('\n'));
    fs.writeFileSync(path.join(glDir, '.oxe', 'config.json'), JSON.stringify({
      profile: 'lean',
      alm: {
        provider: 'azure-devops',
        transport: 'mcp',
        azure_devops: { project: 'CorePlatform' },
        states: { in_progress: 'Active', released: 'Closed' },
      },
    }, null, 2));

    const glPack = onboard.buildOnboardingPack(glDir, { env: { PATH: process.env.PATH || '' }, nativeCheck: false });
    assert.deepEqual(glPack.ci.providers, ['gitlab-ci']);
    assert.ok(glPack.ci.commands.includes('go test ./...'), `must extract GitLab script commands: ${JSON.stringify(glPack.ci.commands)}`);
    assert.equal(glPack.alm.provider, 'azure-devops');
    assert.equal(glPack.alm.configured, true);
    assert.equal(glPack.alm.transport, 'mcp');
    assert.equal(glPack.alm.project, 'CorePlatform');
    assert.ok(glPack.project.stacks.includes('go'));

    // 2. Azure Pipelines + NO ALM + Python
    const azDir = mkDir('oxe-1222-a12-azp-py-');
    fs.mkdirSync(path.join(azDir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(azDir, 'pyproject.toml'), '[project]\nname = "py-svc"\n');
    fs.writeFileSync(path.join(azDir, 'azure-pipelines.yml'), [
      'trigger:',
      '  - main',
      'steps:',
      '  - script: pytest -q',
      '    displayName: Run pytest',
    ].join('\n'));
    fs.writeFileSync(path.join(azDir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));

    const azPack = onboard.buildOnboardingPack(azDir, { env: { PATH: process.env.PATH || '' }, nativeCheck: false });
    assert.deepEqual(azPack.ci.providers, ['azure-pipelines']);
    assert.ok(azPack.ci.commands.includes('pytest -q'), `must extract Azure Pipelines script: ${JSON.stringify(azPack.ci.commands)}`);
    assert.equal(azPack.alm.provider, 'none');
    assert.equal(azPack.alm.configured, false);
    assert.ok(azPack.project.stacks.includes('python'));
    assert.match(azPack.prompt_markdown, /local|sem ALM|none/i);
  });

  it('OXB-222-12: detects Bitbucket Pipelines, CircleCI, Jenkins, and local-only repos without CI or ALM', () => {
    const onboard = require(ONBOARD_MOD);

    const bbDir = mkDir('oxe-1222-a12-bb-');
    fs.writeFileSync(path.join(bbDir, 'bitbucket-pipelines.yml'), 'pipelines:\n  default:\n    - step:\n        script:\n          - npm test\n');
    assert.deepEqual(onboard.detectCiPipelines(bbDir).providers, ['bitbucket-pipelines']);

    const ccDir = mkDir('oxe-1222-a12-cc-');
    fs.mkdirSync(path.join(ccDir, '.circleci'), { recursive: true });
    fs.writeFileSync(path.join(ccDir, '.circleci', 'config.yml'), 'version: 2.1\njobs:\n  test:\n    steps:\n      - run: cargo test\n');
    const ccCi = onboard.detectCiPipelines(ccDir);
    assert.deepEqual(ccCi.providers, ['circleci']);
    assert.ok(ccCi.commands.includes('cargo test'));

    const jkDir = mkDir('oxe-1222-a12-jk-');
    fs.writeFileSync(path.join(jkDir, 'Jenkinsfile'), "pipeline {\n  stages {\n    stage('Test') {\n      steps {\n        sh 'mvn test'\n      }\n    }\n  }\n}\n");
    const jkCi = onboard.detectCiPipelines(jkDir);
    assert.deepEqual(jkCi.providers, ['jenkins']);
    assert.ok(jkCi.commands.includes('mvn test'));

    const bareDir = mkDir('oxe-1222-a12-bare-');
    const barePack = onboard.buildOnboardingPack(bareDir, { env: { PATH: process.env.PATH || '' }, nativeCheck: false });
    assert.deepEqual(barePack.ci.providers, []);
    assert.equal(barePack.ci.mode, 'local-only');
    assert.equal(barePack.alm.provider, 'none');
    assert.equal(barePack.ok, true);
  });

  it('OXB-222-12: CLI oxe-cc onboard is strictly read-only by default, pure JSON with --json, and writes .oxe/ONBOARDING.md only with --write', () => {
    const dir = mkDir('oxe-1222-a12-cli-');
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));

    const beforeFiles = listFilesRecursive(dir);

    const helpRes = spawnSync(process.execPath, [BIN, 'onboard', '--help'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(helpRes.status, 0, helpRes.stderr);
    assert.match(helpRes.stdout, /oxe-cc onboard/i);

    const jsonRes = spawnSync(process.execPath, [BIN, 'onboard', '--json', '--dir', dir], { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(jsonRes.status, 0, jsonRes.stderr || jsonRes.stdout);
    const payload = JSON.parse(jsonRes.stdout);
    assert.equal(payload.oxeOnboardSchema, 1);
    assert.equal(payload.read_only, true);
    assert.equal(payload.written_path, null);
    assert.deepEqual(listFilesRecursive(dir), beforeFiles, 'onboard --json must not write any files to disk');

    const writeRes = spawnSync(process.execPath, [BIN, 'onboard', '--write', '--json', '--dir', dir], { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(writeRes.status, 0, writeRes.stderr || writeRes.stdout);
    const writePayload = JSON.parse(writeRes.stdout);
    assert.equal(writePayload.written_path, '.oxe/ONBOARDING.md');
    assert.equal(fs.existsSync(path.join(dir, '.oxe', 'ONBOARDING.md')), true);
  });

  it('OXB-222-12: oxe-cc onboard --json runs cleanly on real oxe-build repo without side effects', () => {
    const res = spawnSync(process.execPath, [BIN, 'onboard', '--json', '--dir', REPO_ROOT], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.oxeOnboardSchema, 1);
    assert.equal(payload.ok, true);
    assert.equal(payload.read_only, true);
    assert.ok(payload.ci.providers.includes('github-actions'));
    // .oxe/config.json is gitignored on clean CI checkouts; match actual local config when present, agnostic defaults otherwise
    let localCfg = null;
    try { localCfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.oxe', 'config.json'), 'utf8')); } catch { localCfg = null; }
    const expectedAlm = (localCfg && localCfg.alm && localCfg.alm.provider) ? String(localCfg.alm.provider).toLowerCase() : 'none';
    const expectedProfile = (localCfg && localCfg.profile) ? String(localCfg.profile) : 'balanced';
    assert.equal(payload.alm.provider, expectedAlm);
    assert.equal(payload.oxe.profile, expectedProfile);
    assert.ok(typeof payload.prompt_markdown === 'string' && payload.prompt_markdown.length > 100);
  });
});
