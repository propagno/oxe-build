'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const oxeHealth = require('../../bin/lib/oxe-project-health.cjs');
const ciParity = require('../../bin/lib/oxe-ci-parity.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkProductPackageRepo(prefix = 'oxe-a2-pkg-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'oxe-cc',
    version: '1.23.0',
    engines: { node: '>=18.0.0' },
  }, null, 2));
  fs.mkdirSync(path.join(dir, 'packages', 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages', 'runtime', 'package.json'), JSON.stringify({ name: '@oxe/runtime', version: '1.23.0' }));
  fs.mkdirSync(path.join(dir, 'oxe', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'oxe', 'workflows', 'help.md'), '# help\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/sessions\n.oxe/config.json\nnode_modules/\n');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# OXE — Estado\n\n## Fase atual\n\n`verify_complete`\n\n## Sessão ativa\n- **active_session:** sessions/s999-gitignored-local\n');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'reference-projects.cjs'), "const pkg = { engines: { node: '>=18' } };\n");
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init product package'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A2 — Isolamento .oxe/ em product_package e gate oxe-cc doctor --ci-parity (OXB-230-02)', () => {
  it('OXB-230-02: doctor does not report broken for gitignored active_session in product_package while preserving broken for normal oxe_project', () => {
    const pkgDir = mkProductPackageRepo('oxe-a2-pkg-');
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a2-user-'));
    try {
      const pkgReport = oxeHealth.buildHealthReport(pkgDir);
      assert.equal(pkgReport.workspaceMode, 'product_package');
      assert.notEqual(pkgReport.healthStatus, 'broken', `product_package with gitignored missing session must not be broken, got warnings: ${JSON.stringify(pkgReport.sessionWarn)}`);

      // Normal oxe_project WITHOUT gitignored sessions MUST still flag broken on dangling active_session
      fs.mkdirSync(path.join(userDir, '.oxe'), { recursive: true });
      fs.writeFileSync(path.join(userDir, 'package.json'), JSON.stringify({ name: 'normal-app', version: '1.0.0' }));
      fs.writeFileSync(path.join(userDir, '.oxe', 'STATE.md'), '# OXE\n\n## Fase atual\n`executing`\n\n## Sessão ativa\n- **active_session:** sessions/s001-missing\n');
      const userReport = oxeHealth.buildHealthReport(userDir);
      assert.equal(userReport.workspaceMode, 'oxe_project');
      assert.equal(userReport.healthStatus, 'broken');
    } finally {
      fs.rmSync(pkgDir, { recursive: true, force: true });
      fs.rmSync(userDir, { recursive: true, force: true });
    }
  });

  it('OXB-230-02: runCiParityCheck and CLI oxe-cc doctor --ci-parity --json check clean-checkout doctor, engines.node parity, and POSIX symlink gitignore rules', () => {
    const dir = mkProductPackageRepo('oxe-a2-parity-');
    try {
      const okRes = ciParity.runCiParityCheck(dir);
      assert.equal(okRes.ok, true, `expected parity ok, got: ${JSON.stringify(okRes)}`);
      assert.equal(okRes.checks.clean_checkout_doctor.ok, true);
      assert.equal(okRes.checks.engines_parity.ok, true);
      assert.equal(okRes.checks.posix_symlink_gitignore.ok, true);

      // CLI `oxe-cc doctor --ci-parity --dir <dir> --json`
      const cliOut = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'doctor', '--ci-parity', '--dir', dir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(cliOut.oxeCiParitySchema, 1);
      assert.equal(cliOut.ok, true);

      // Break engines parity (template asks >=20 while root package supports >=18) -> must catch!
      fs.writeFileSync(path.join(dir, 'scripts', 'reference-projects.cjs'), "const pkg = { engines: { node: '>=20' } };\n");
      execFileSync('git', ['add', 'scripts/reference-projects.cjs'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'drift engines'], { cwd: dir, stdio: 'ignore' });
      const badRes = ciParity.runCiParityCheck(dir);
      assert.equal(badRes.ok, false);
      assert.equal(badRes.checks.engines_parity.ok, false);
      assert.ok(badRes.problems.some((p) => /engines\.node|>=20/i.test(p)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
