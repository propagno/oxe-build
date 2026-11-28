'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const agentInstall = require(path.join(REPO_ROOT, 'bin/lib/oxe-agent-install.cjs'));

describe('OxeChat / OxeCode flat skills installer (~/.oxe/skills/*.md)', () => {
  it('installs flat OXE skills with YAML frontmatter (name, description, agents: [], category: oxe) and cleans up only managed files', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-skills-home-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-skills-proj-'));
    try {
      const globalPaths = agentInstall.buildAgentInstallPaths(true, tmpProj, { home: tmpHome });
      const localPaths = agentInstall.buildAgentInstallPaths(false, tmpProj, { home: tmpHome });
      assert.equal(globalPaths.oxeSkillsDir, path.join(tmpHome, '.oxe', 'skills'));
      assert.equal(localPaths.oxeSkillsDir, path.join(tmpProj, '.oxe', 'skills'));

      // Pre-create a user custom skill that must NEVER be touched or deleted
      fs.mkdirSync(globalPaths.oxeSkillsDir, { recursive: true });
      const userSkill = path.join(globalPaths.oxeSkillsDir, 'my-custom-skill.md');
      fs.writeFileSync(userSkill, '---\nname: my-custom-skill\ndescription: Custom\n---\nHello\n', 'utf8');

      const cCmdSrc = path.join(REPO_ROOT, '.cursor', 'commands');
      agentInstall.installOxeSkills(cCmdSrc, globalPaths.oxeSkillsDir, { dryRun: false, force: true }, true);

      const specSkillPath = path.join(globalPaths.oxeSkillsDir, 'oxe-spec.md');
      const deliverSkillPath = path.join(globalPaths.oxeSkillsDir, 'oxe-deliver.md');
      const rootOxePath = path.join(globalPaths.oxeSkillsDir, 'oxe.md');
      assert.ok(fs.existsSync(specSkillPath), 'oxe-spec.md deve ser criado em ~/.oxe/skills');
      assert.ok(fs.existsSync(deliverSkillPath), 'oxe-deliver.md deve ser criado em ~/.oxe/skills');
      assert.ok(fs.existsSync(rootOxePath), 'oxe.md deve ser criado em ~/.oxe/skills');

      const specRaw = fs.readFileSync(specSkillPath, 'utf8');
      assert.match(specRaw, /^---\nname: oxe-spec\n/m);
      assert.match(specRaw, /^description: "/m);
      assert.match(specRaw, /^agents: \[\]$/m);
      assert.match(specRaw, /^category: oxe$/m);
      assert.match(specRaw, /<!-- oxe-cc managed -->/);

      // Cleanup removes only OXE-managed files and preserves user skills
      agentInstall.cleanupMarkedUnifiedArtifacts({ dryRun: false }, globalPaths);
      assert.equal(fs.existsSync(specSkillPath), false, 'oxe-spec.md gerenciado deve ser removido no cleanup');
      assert.equal(fs.existsSync(userSkill), true, 'skill customizada do usuário deve permanecer intacta');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpProj, { recursive: true, force: true });
    }
  });

  it('default oxe-cc install --ide-local --yes (without --all-agents) populates .oxe/skills/oxe-spec.md for OxeChat', () => {
    const { spawnSync } = require('node:child_process');
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-install-default-'));
    try {
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      const res = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, 'bin/oxe-cc.js'), 'install', '--dir', tmpProj, '--ide-local', '--force'],
        { cwd: REPO_ROOT, env: childEnv, encoding: 'utf8', windowsHide: true }
      );
      assert.equal(res.status, 0, `install falhou:\n${res.stdout}\n${res.stderr}`);
      const specSkill = path.join(tmpProj, '.oxe', 'skills', 'oxe-spec.md');
      assert.ok(fs.existsSync(specSkill), 'install padrão deve criar .oxe/skills/oxe-spec.md');
      assert.match(fs.readFileSync(specSkill, 'utf8'), /^name: oxe-spec$/m);
    } finally {
      fs.rmSync(tmpProj, { recursive: true, force: true });
    }
  });
});
