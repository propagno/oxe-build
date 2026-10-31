'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { isolatedHomeEnv } = require('./isolated-home-env.cjs');
const { pickVsixFile, shouldInstallVscodeExtension } = require('../bin/lib/oxe-install-resolve.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'oxe-cc.js');

// Regressões do e2e "linkly": VSIX 1.9.1 escolhido por ordenação de string, extensão VS Code
// instalada sem ser pedida, ausência de `--claude` e doctor sem detectar `.claude/` local.

describe('install — Claude Code e extensão VS Code', () => {
  const dirs = [];

  after(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pickVsixFile prefere a versão do pacote e, sem ela, o maior semver', () => {
    const files = ['oxe-agents-1.9.1.vsix', 'oxe-agents-1.16.0.vsix', 'oxe-agents-1.10.0.vsix', 'README.md'];
    assert.equal(pickVsixFile(files, '1.16.0'), 'oxe-agents-1.16.0.vsix');
    assert.equal(pickVsixFile(files, '2.0.0'), 'oxe-agents-1.16.0.vsix');
    assert.equal(pickVsixFile(['oxe-agents-1.9.1.vsix', 'oxe-agents-1.10.0.vsix'], '9.9.9'), 'oxe-agents-1.10.0.vsix');
    assert.equal(pickVsixFile([], '1.0.0'), null);
  });

  it('extensão VS Code só com integração VS Code/Copilot', () => {
    assert.equal(shouldInstallVscodeExtension({ copilotCli: true }), false);
    assert.equal(shouldInstallVscodeExtension({ cursor: true }), false);
    assert.equal(shouldInstallVscodeExtension({ copilot: true }), true);
    assert.equal(shouldInstallVscodeExtension({ vscode: true }), true);
    assert.equal(shouldInstallVscodeExtension({ allAgents: true }), true);
  });

  it('`--claude --ide-local` instala .claude/ no projeto e o doctor detecta Claude Code', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-claude-proj-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-claude-home-'));
    dirs.push(project, home);
    const env = isolatedHomeEnv(home, { OXE_NO_PROMPT: '1' });

    const install = spawnSync(process.execPath, [CLI, '--claude', '--ide-local', '--no-global-cli', '--dir', project], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });
    assert.equal(install.status, 0, install.stderr + install.stdout);
    assert.ok(fs.existsSync(path.join(project, '.claude', 'commands', 'oxe.md')), 'commands do Claude no projeto');
    assert.ok(fs.existsSync(path.join(project, '.claude', 'agents', 'oxe-planner.md')), 'agents do Claude no projeto');
    assert.doesNotMatch(install.stdout, /VS Code extension instalada/, 'não deve instalar a extensão VS Code sem pedido');

    const doctor = spawnSync(process.execPath, [CLI, 'doctor', '--dir', project], { cwd: REPO_ROOT, encoding: 'utf8', env });
    const out = doctor.stdout.replace(/\x1b\[[0-9;]*m/g, '');
    assert.doesNotMatch(out, /Claude Code não detectado/, out);
  });
});
