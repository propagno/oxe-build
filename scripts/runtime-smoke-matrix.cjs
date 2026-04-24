#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const release = require('../bin/lib/oxe-release.cjs');

const PACKAGE_ROOT = process.env.OXE_RELEASE_PACKAGE_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PACKAGE_ROOT)
  : path.join(__dirname, '..');
const PROJECT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT)
  : PACKAGE_ROOT;
const CLI = path.join(PACKAGE_ROOT, 'bin', 'oxe-cc.js');

function isolatedHomeEnv(fakeHome, extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CURSOR_CONFIG_DIR;
  delete env.COPILOT_CONFIG_DIR;
  delete env.COPILOT_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  env.HOME = fakeHome;
  env.USERPROFILE = fakeHome;
  env.XDG_CONFIG_HOME = path.join(fakeHome, '.config');
  env.OXE_NO_BANNER = '1';
  env.OXE_NO_PROMPT = '1';
  return env;
}

function runCli(args, env, cwd = PACKAGE_ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

function readIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch {
    return '';
  }
}

function hasResolutionPolicy(text) {
  return /\.oxe\/workflows\//.test(text)
    && /oxe\/workflows\//.test(text)
    && /(oxe-workflow-resolution:start|subir diret[oó]rios|walk up|prefer \.oxe\/workflows)/i.test(text);
}

function hasNoLegacySourceReferences(text) {
  return !/(get shit done|get-shit-done|\bGSD\b|\/gsd|gsd-tools|\.planning|commands\/gsd)/i.test(text);
}

function isOxeAgentArtifact(text) {
  return /OXE/.test(text) && /(\.oxe\/|oxe-cc runtime|evidence|plan-agents\.json)/i.test(text);
}

function runtimeCases() {
  return [
    {
      runtime: 'cursor',
      installArgs: ['--cursor', '--ide-local', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--cursor', '--ide-local', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome, dir) => path.join(dir, '.cursor', 'commands', 'oxe.md'),
    },
    {
      runtime: 'copilot_vscode',
      installArgs: ['--copilot', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--copilot', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome, dir) => path.join(dir, '.github', 'prompts', 'oxe.prompt.md'),
    },
    {
      runtime: 'claude_code',
      installArgs: ['--copilot-cli', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--copilot-cli', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome) => path.join(fakeHome, '.claude', 'commands', 'oxe.md'),
      agentPaths: (fakeHome) => [
        path.join(fakeHome, '.claude', 'agents', 'oxe-planner.md'),
        path.join(fakeHome, '.claude', 'agents', 'oxe-verifier.md'),
      ],
    },
    {
      runtime: 'codex',
      installArgs: ['--codex', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--codex', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome) => path.join(fakeHome, '.codex', 'prompts', 'oxe.md'),
      extraPaths: (fakeHome) => [
        path.join(fakeHome, '.agents', 'skills', 'oxe', 'SKILL.md'),
      ],
      agentPaths: (fakeHome) => [
        path.join(fakeHome, '.agents', 'skills', 'oxe-planner', 'SKILL.md'),
        path.join(fakeHome, '.agents', 'skills', 'oxe-verifier', 'SKILL.md'),
      ],
    },
    {
      runtime: 'opencode',
      installArgs: ['--opencode', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--opencode', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome) => path.join(fakeHome, '.config', 'opencode', 'commands', 'oxe.md'),
    },
    {
      runtime: 'gemini',
      installArgs: ['--gemini', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--gemini', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome) => path.join(fakeHome, '.gemini', 'commands', 'oxe.toml'),
    },
    {
      runtime: 'windsurf',
      installArgs: ['--windsurf', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--windsurf', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome) => path.join(fakeHome, '.codeium', 'windsurf', 'global_workflows', 'oxe.md'),
    },
    {
      runtime: 'antigravity',
      installArgs: ['--antigravity', '--no-init-oxe', '--no-global-cli', '--dir', '__DIR__'],
      uninstallArgs: ['uninstall', '--antigravity', '--ide-only', '--dir', '__DIR__'],
      entrypoint: (fakeHome) => path.join(fakeHome, '.gemini', 'antigravity', 'skills', 'oxe', 'SKILL.md'),
    },
  ];
}

function evaluateRuntime(runtimeCase) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-smoke-home-${runtimeCase.runtime}-`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oxe-smoke-proj-${runtimeCase.runtime}-`));
  const env = isolatedHomeEnv(fakeHome);
  const installArgs = runtimeCase.installArgs.map((value) => (value === '__DIR__' ? dir : value));
  const uninstallArgs = runtimeCase.uninstallArgs.map((value) => (value === '__DIR__' ? dir : value));
  const entrypoint = runtimeCase.entrypoint(fakeHome, dir);
  const extraPaths = typeof runtimeCase.extraPaths === 'function'
    ? runtimeCase.extraPaths(fakeHome, dir)
    : [];
  const agentPaths = typeof runtimeCase.agentPaths === 'function'
    ? runtimeCase.agentPaths(fakeHome, dir)
    : [];

  const install = runCli(installArgs, env);
  const installOk = install.status === 0;
  const oxePresent = fs.existsSync(entrypoint);
  const content = readIfExists(entrypoint);
  const workflowResolutionOk = oxePresent && hasResolutionPolicy(content);
  const wrapperDriftOk = workflowResolutionOk;
  const extraChecks = extraPaths.map((filePath) => {
    const exists = fs.existsSync(filePath);
    const text = readIfExists(filePath);
    return {
      path: filePath,
      exists,
      workflow_resolution_ok: exists && hasResolutionPolicy(text),
    };
  });
  const extraChecksOk = extraChecks.every((item) => item.exists && item.workflow_resolution_ok);
  const agentChecks = agentPaths.map((filePath) => {
    const exists = fs.existsSync(filePath);
    const text = readIfExists(filePath);
    return {
      path: filePath,
      exists,
      oxe_agent_ok: exists && isOxeAgentArtifact(text),
      no_legacy_refs: exists && hasNoLegacySourceReferences(text),
    };
  });
  const agentChecksOk = agentChecks.every((item) => item.exists && item.oxe_agent_ok && item.no_legacy_refs);
  const uninstall = runCli(uninstallArgs, env);
  const uninstallOk = uninstall.status === 0
    && !fs.existsSync(entrypoint)
    && extraPaths.every((filePath) => !fs.existsSync(filePath))
    && agentPaths.every((filePath) => !fs.existsSync(filePath));

  return {
    runtime: runtimeCase.runtime,
    supported: true,
    install_ok: installOk,
    oxe_present: oxePresent,
    workflow_resolution_ok: workflowResolutionOk,
    wrapper_drift_ok: wrapperDriftOk,
    extra_checks_ok: extraChecksOk,
    extra_checks: extraChecks,
    agent_checks_ok: agentChecksOk,
    agent_checks: agentChecks,
    uninstall_ok: uninstallOk,
    observations: [
      installOk ? null : `install failed: ${(install.stderr || install.stdout || '').trim()}`,
      oxePresent ? null : 'entrypoint oxe ausente',
      workflowResolutionOk ? null : 'wrapper sem política de resolução walk-up/.oxe→oxe',
      wrapperDriftOk ? null : 'wrapper com drift em relação ao contrato esperado',
      extraChecksOk ? null : `checks extras falharam: ${extraChecks.filter((item) => !item.exists || !item.workflow_resolution_ok).map((item) => path.basename(item.path)).join(', ')}`,
      agentChecksOk ? null : `checks de agentes falharam: ${agentChecks.filter((item) => !item.exists || !item.oxe_agent_ok || !item.no_legacy_refs).map((item) => path.basename(item.path)).join(', ')}`,
      uninstallOk ? null : `uninstall failed: ${(uninstall.stderr || uninstall.stdout || '').trim()}`,
    ].filter(Boolean),
  };
}

function main() {
  const results = runtimeCases().map((template) => evaluateRuntime(template));
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    required_runtimes: release.REQUIRED_RUNTIMES,
    results,
    summary: {
      total: results.length,
      pass: results.filter((item) => item.install_ok && item.oxe_present && item.workflow_resolution_ok && item.wrapper_drift_ok && item.extra_checks_ok !== false && item.agent_checks_ok !== false && item.uninstall_ok).length,
      fail: results.filter((item) => !(item.install_ok && item.oxe_present && item.workflow_resolution_ok && item.wrapper_drift_ok && item.extra_checks_ok !== false && item.agent_checks_ok !== false && item.uninstall_ok)).length,
    },
  };
  const reportPath = release.releasePaths(PROJECT_ROOT).smokeReport;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  if (report.summary.fail > 0) {
    console.error(`runtime-smoke-matrix: ${report.summary.fail} runtime(s) com falha`);
    process.exit(1);
  }
  console.log(`runtime-smoke-matrix: OK (${report.summary.pass}/${report.summary.total})`);
}

main();
