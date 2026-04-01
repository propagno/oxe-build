'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agent = require('../bin/lib/oxe-agent-install.cjs');
const { IDE_HOME_VARS } = require('./isolated-home-env.cjs');

const REPO = path.join(__dirname, '..');
const C_CMD = path.join(REPO, '.cursor', 'commands');

function withFakeHome(fakeHome, fn) {
  /** @type {Record<string, string | undefined>} */
  const saved = {};
  for (const k of [...IDE_HOME_VARS, 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'CODEX_HOME']) {
    saved[k] = process.env[k];
    if (IDE_HOME_VARS.includes(k)) delete process.env[k];
  }
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.XDG_CONFIG_HOME = path.join(fakeHome, '.config');
  process.env.CODEX_HOME = path.join(fakeHome, '.codex');
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('oxe-agent-install', () => {
  test('parseCursorCommandFrontmatter without yaml', () => {
    const r = agent.parseCursorCommandFrontmatter('plain\nbody');
    assert.strictEqual(r.description, '');
    assert.ok(r.body.includes('plain'));
  });

  test('parseCursorCommandFrontmatter unclosed yaml', () => {
    const r = agent.parseCursorCommandFrontmatter('---\ndescription: x\n');
    assert.strictEqual(r.description, '');
  });

  test('adjustWorkflowPathsForNestedLayout', () => {
    const t = agent.adjustWorkflowPathsForNestedLayout('Ver oxe/workflows/scan.md e oxe/templates/X');
    assert.ok(t.includes('.oxe/workflows/'));
    assert.ok(t.includes('.oxe/templates/'));
  });

  test('buildAgentSkillMarkdown', () => {
    const md = agent.buildAgentSkillMarkdown('oxe-scan', 'd', 'body');
    assert.match(md, /name: oxe-scan/);
    assert.ok(md.includes(agent.OXE_MANAGED_HTML));
  });

  test('installSkillTreeFromCursorCommands writes skills', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const skills = path.join(home, '.copilot', 'skills');
      agent.installSkillTreeFromCursorCommands(C_CMD, skills, { dryRun: false, force: true }, false);
      assert.ok(fs.existsSync(path.join(skills, 'oxe-scan', 'SKILL.md')));
    });
  });

  test('installOpenCodeCommands writes both opencode dirs', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const paths = agent.buildAgentInstallPaths(true, home);
      agent.installOpenCodeCommands(C_CMD, paths, { dryRun: false, force: true }, false);
      const xdg = path.join(home, '.config', 'opencode', 'commands', 'oxe-scan.md');
      const alt = path.join(home, '.opencode', 'commands', 'oxe-scan.md');
      assert.ok(fs.existsSync(xdg) || fs.existsSync(alt));
      assert.ok(fs.existsSync(xdg));
      assert.ok(fs.existsSync(alt));
    });
  });

  test('installOpenCodeCommands ide-local writes under project', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-proj-'));
    const paths = agent.buildAgentInstallPaths(false, proj);
    agent.installOpenCodeCommands(C_CMD, paths, { dryRun: false, force: true }, false);
    const one = path.join(proj, '.opencode', 'commands', 'oxe-scan.md');
    assert.ok(fs.existsSync(one));
  });

  test('installGeminiTomlCommands', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const paths = agent.buildAgentInstallPaths(true, home);
      agent.installGeminiTomlCommands(C_CMD, paths, { dryRun: false, force: true }, false);
      const oxeToml = path.join(home, '.gemini', 'commands', 'oxe.toml');
      assert.ok(fs.existsSync(oxeToml));
    });
  });

  test('installWindsurfGlobalWorkflows and oxe.md omitido', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const logs = [];
      const paths = agent.buildAgentInstallPaths(true, home);
      agent.installWindsurfGlobalWorkflows(
        C_CMD,
        paths,
        { dryRun: false, force: true },
        false,
        (d) => logs.push(['omit', d]),
        () => {}
      );
      const wf = path.join(home, '.codeium', 'windsurf', 'global_workflows', 'oxe-scan.md');
      assert.ok(fs.existsSync(wf));
      agent.installWindsurfGlobalWorkflows(
        C_CMD,
        paths,
        { dryRun: false, force: false },
        false,
        (d) => logs.push(['omit', d]),
        () => {}
      );
      assert.ok(logs.some((x) => x[0] === 'omit'));
    });
  });

  test('installCodexPrompts', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const paths = agent.buildAgentInstallPaths(true, home);
      agent.installCodexPrompts(C_CMD, paths, { dryRun: false, force: true }, false);
      const p = path.join(home, '.codex', 'prompts', 'oxe-scan.md');
      assert.ok(fs.existsSync(p));
    });
  });

  test('cleanupMarkedUnifiedArtifacts removes managed files', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const paths = agent.buildAgentInstallPaths(true, home);
      agent.installOpenCodeCommands(C_CMD, paths, { dryRun: false, force: true }, false);
      const xdg = path.join(home, '.config', 'opencode', 'commands', 'oxe-scan.md');
      assert.ok(fs.existsSync(xdg));
      agent.cleanupMarkedUnifiedArtifacts({ dryRun: false }, paths);
      assert.ok(!fs.existsSync(xdg));
    });
  });

  test('cleanup dryRun no unlink', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const paths = agent.buildAgentInstallPaths(true, home);
      agent.installOpenCodeCommands(C_CMD, paths, { dryRun: false, force: true }, false);
      const xdg = path.join(home, '.config', 'opencode', 'commands', 'oxe-scan.md');
      agent.cleanupMarkedUnifiedArtifacts({ dryRun: true }, paths);
      assert.ok(fs.existsSync(xdg));
    });
  });

  test('opencodeCommandDirs and path helpers', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ag-'));
    withFakeHome(home, () => {
      const d = agent.opencodeCommandDirs();
      assert.strictEqual(d.length, 2);
      assert.ok(d[0].includes('opencode'));
    });
  });
});
