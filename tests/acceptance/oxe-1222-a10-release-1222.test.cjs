'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const releaseLib = require('../../bin/lib/oxe-release.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A10 — OXB-222-10: ADR D-7 and v1.22.2 synchronized version cut', () => {
  it('OXB-222-10: ADR D-7 exists and preserves D-1..D-6', () => {
    const adrDir = path.join(REPO_ROOT, 'docs', 'adr');
    const files = fs.readdirSync(adrDir).filter((f) => f.endsWith('.md'));
    for (let i = 1; i <= 6; i += 1) {
      assert.ok(files.some((f) => f.startsWith(`D-${i}-`)), `prior ADR D-${i} must be preserved in docs/adr/`);
    }
    const d7 = files.find((f) => f.startsWith('D-7-'));
    assert.ok(d7, `ADR D-7 must exist in docs/adr/, found: ${files.join(', ')}`);
    const d7Body = fs.readFileSync(path.join(adrDir, d7), 'utf8');
    assert.match(d7Body, /phase_gates|preflight\.triggers/i);
    assert.match(d7Body, /version_pins|oxe-cc sync/i);
    assert.match(d7Body, /--json|compact/i);
  });

  it('OXB-222-10: version 1.22.2 is synchronized across all 5 sources and CHANGELOG.md', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const rtPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'runtime', 'package.json'), 'utf8'));
    const vsPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vscode-extension', 'package.json'), 'utf8'));
    const lockPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');

    assert.equal(rootPkg.version, '1.22.2');
    assert.equal(rtPkg.version, '1.22.2');
    assert.equal(vsPkg.version, '1.22.2');
    assert.equal(lockPkg.version, '1.22.2');
    assert.equal(lockPkg.packages[''].version, '1.22.2');
    assert.match(readme, /\*\*Versão:\*\*\s*`1\.22\.2`/);
    assert.match(changelog, /^[\s\S]{0,400}## \[1\.22\.2\]/);

    // Release consistency module reads matching target version 1.22.2
    const readiness = releaseLib.inspectReleaseReadiness(REPO_ROOT, { packageRoot: REPO_ROOT });
    assert.equal(readiness.targetVersion, '1.22.2');
  });
});
