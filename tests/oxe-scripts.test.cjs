'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const release = require('../bin/lib/oxe-release.cjs');

describe('scripts', () => {
  test('oxe-assets-scan exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'oxe-assets-scan.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
  });

  test('oxe-assets-scan exits 1 when OpenAI-style pattern in fixture tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-assets-bad-'));
    const oxeDir = path.join(root, 'oxe');
    const ghDir = path.join(root, '.github');
    const binLib = path.join(root, 'bin', 'lib');
    fs.mkdirSync(oxeDir, { recursive: true });
    fs.mkdirSync(ghDir, { recursive: true });
    fs.mkdirSync(binLib, { recursive: true });
    // Regex: sk-[a-zA-Z0-9]{20,} — fake token-shaped string (not a real secret)
    fs.writeFileSync(
      path.join(oxeDir, 'leak.md'),
      'placeholder sk-abcdefghijklmnopqrstuv not-a-real-key\n',
      'utf8'
    );
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'oxe-assets-scan.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_ASSETS_SCAN_ROOT: root },
    });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /\[oxe-assets-scan\]/);
    assert.match(r.stderr, /finding\(s\)/i);
  });

  test('sync-cursor-from-prompts exits 0', () => {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = fs.readFileSync(path.join(REPO_ROOT, '.cursor', 'commands', 'oxe-session.md'), 'utf8');
    assert.match(out, /Gerir sessões|Gerir sessoes|OXE — Gerir sessões/i);
    const ask = fs.readFileSync(path.join(REPO_ROOT, '.cursor', 'commands', 'oxe-ask.md'), 'utf8');
    assert.match(ask, /Perguntar ao OXE|situação atual|sessão ativa/i);
    const plan = fs.readFileSync(path.join(REPO_ROOT, '.cursor', 'commands', 'oxe-plan.md'), 'utf8');
    assert.match(plan, /oxe_reasoning_mode:\s*planning/);
    assert.match(plan, /oxe_output_contract:\s*plan/);
    assert.match(plan, /oxe-reasoning-contract:start/);
  });

  test('sync-cursor-from-prompts fails without .github/prompts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-'));
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /prompts ausente/i);
  });

  test('sync-cursor-from-prompts uses default description when frontmatter omits description', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-desc-'));
    const prompts = path.join(dir, '.github', 'prompts');
    const dest = path.join(dir, '.cursor', 'commands');
    fs.mkdirSync(prompts, { recursive: true });
    const raw = '---\nname: oxe-plain\n---\n\nBody only.\n';
    fs.writeFileSync(path.join(prompts, 'oxe-plain.prompt.md'), raw, 'utf8');
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = fs.readFileSync(path.join(dest, 'oxe-plain.md'), 'utf8');
    assert.match(out, /description: "Comando OXE"/);
  });

  test('sync-cursor-from-prompts handles CRLF frontmatter in prompts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-crlf-'));
    const prompts = path.join(dir, '.github', 'prompts');
    const dest = path.join(dir, '.cursor', 'commands');
    fs.mkdirSync(prompts, { recursive: true });
    const crlfFront =
      '---\r\n' +
      'name: oxe-crlf\r\n' +
      'description: Teste CRLF sync descrição rica\r\n' +
      '---\r\n' +
      '\r\n' +
      'Corpo do comando.\r\n';
    fs.writeFileSync(path.join(prompts, 'oxe-crlf.prompt.md'), crlfFront, 'utf8');
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-cursor-from-prompts.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = fs.readFileSync(path.join(dest, 'oxe-crlf.md'), 'utf8');
    assert.match(out, /description: "Teste CRLF sync descrição rica"/);
    assert.ok(out.includes('Corpo do comando.'));
  });

  test('sync-runtime-metadata adds shared metadata and reasoning contract to prompts and commands', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-sync-meta-'));
    const promptDir = path.join(dir, '.github', 'prompts');
    const commandDir = path.join(dir, 'commands', 'oxe');
    const cursorDir = path.join(dir, '.cursor', 'commands');
    const canonicalWorkflows = path.join(dir, 'oxe', 'workflows');
    const canonicalRefs = path.join(canonicalWorkflows, 'references');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.mkdirSync(commandDir, { recursive: true });
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.mkdirSync(canonicalRefs, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'oxe', 'workflows', 'plan.md'),
      path.join(canonicalWorkflows, 'plan.md')
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'oxe', 'workflows', 'references', 'workflow-runtime-contracts.json'),
      path.join(canonicalRefs, 'workflow-runtime-contracts.json')
    );
    fs.writeFileSync(
      path.join(promptDir, 'oxe-plan.prompt.md'),
      '---\nname: oxe-plan\nagent: agent\ndescription: Demo\n---\n\n<!-- oxe-workflow-resolution:start -->\nbloco antigo\n<!-- oxe-workflow-resolution:end -->\n\n**Workflow canónico:** `oxe/workflows/plan.md`\n\nExecuta o workflow **OXE plan**.\n\n`.oxe/workflows/plan.md`\n\nCorpo prompt. Lê `.oxe/workflows/plan.md` na raiz do projeto atual (CWD).\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(commandDir, 'plan.md'),
      '---\nname: oxe:plan\ndescription: Demo\nallowed-tools:\n  - Read\n---\n\n**Workflow canónico:** `oxe/workflows/plan.md`\n\nExecute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa `$ARGUMENTS` como foco.\n',
      'utf8'
    );
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-runtime-metadata.cjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, OXE_SYNC_REPO_ROOT: dir },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const promptOut = fs.readFileSync(path.join(promptDir, 'oxe-plan.prompt.md'), 'utf8');
    const commandOut = fs.readFileSync(path.join(commandDir, 'plan.md'), 'utf8');
    assert.match(promptOut, /oxe_reasoning_mode:\s*planning/);
    assert.match(commandOut, /oxe_output_contract:\s*plan/);
    assert.match(promptOut, /oxe-reasoning-contract:start/);
    assert.match(commandOut, /Referência canónica/);
    assert.match(promptOut, /oxe-workflow-resolution:start/);
    assert.match(commandOut, /oxe-workflow-resolution:start/);
    assert.doesNotMatch(promptOut, /\*\*Workflow can[óôo]nic[oa]:\*\*/i);
    assert.doesNotMatch(commandOut, /\*\*Workflow can[óôo]nic[oa]:\*\*/i);
    assert.doesNotMatch(promptOut, /raiz do projeto atual \(CWD\)/i);
    assert.doesNotMatch(commandOut, /na raiz do repositório em que estás a trabalhar/i);
    const manifestPath = path.join(dir, '.oxe', 'install', 'runtime-semantics.json');
    assert.strictEqual(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.target, 'runtime-semantics');
    assert.ok(manifest.contract_version);
    assert.ok(manifest.wrappers['.github/prompts']);
    assert.ok(manifest.wrappers['commands/oxe']);
  });

  test('release-doctor writes manifest and blocks incomplete release project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-release-doctor-'));
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'release-doctor.cjs'), '--write-manifest'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        OXE_RELEASE_PROJECT_ROOT: dir,
        OXE_RELEASE_PACKAGE_ROOT: REPO_ROOT,
      },
    });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    const manifestPath = path.join(dir, '.oxe', 'release', 'release-manifest.json');
    assert.strictEqual(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.versions);
    assert.ok(manifest.reports);
  });

  test('release report loaders require 1.10 runtime-real scenarios and merge evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-release-report-contract-'));
    const releaseDir = path.join(dir, '.oxe', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(releaseDir, 'runtime-real-report.json'),
      JSON.stringify({
        results: [
          { name: 'static-html-js', ok: true },
        ],
      }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(releaseDir, 'multi-agent-real-report.json'),
      JSON.stringify({
        results: [
          {
            scenario: 'parallel_git_worktree_success',
            ok: true,
            report: {
              records: [
                {
                  status: 'merged',
                  verify_status: 'partial',
                  evidence_refs: [],
                  applied_paths: [],
                  diff_summary: { paths: [] },
                },
              ],
            },
          },
        ],
      }, null, 2),
      'utf8'
    );
    const runtimeReal = release.loadRuntimeRealReport(dir);
    const multiAgentReal = release.loadMultiAgentRealReport(dir);
    assert.strictEqual(runtimeReal.ok, false);
    assert.ok(runtimeReal.missingRequired.includes('multi_wave_app'));
    assert.strictEqual(multiAgentReal.ok, false);
    assert.deepStrictEqual(multiAgentReal.failures, ['parallel_git_worktree_success']);
  });
});
