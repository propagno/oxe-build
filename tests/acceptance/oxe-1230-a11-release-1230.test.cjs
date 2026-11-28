'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const releaseLib = require('../../bin/lib/oxe-release.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A11 — ADR D-8, corte de versão 1.23.0 nas 5 fontes + CHANGELOG e docs/workflows (OXB-230-11)', () => {
  it('OXB-230-11: ADR D-8 exists in docs/adr/ preserving D-1..D-7 and version 1.23.0 is synchronized across all 5 sources, CHANGELOG.md, and workflow docs', () => {
    const adrDir = path.join(REPO_ROOT, 'docs/adr/');
    const adrFiles = fs.readdirSync(adrDir).filter((f) => f.endsWith('.md'));
    for (let i = 1; i <= 7; i += 1) {
      assert.ok(adrFiles.some((f) => f.startsWith(`D-${i}-`)), `prior ADR D-${i} must be preserved in docs/adr/`);
    }
    const d8 = adrFiles.find((f) => f.startsWith('D-8-'));
    assert.ok(d8, `ADR D-8 must exist in docs/adr/, found: ${adrFiles.join(', ')}`);
    const d8Body = fs.readFileSync(path.join(adrDir, d8), 'utf8');
    assert.match(d8Body, /oxe-cc mcp|MCP/i);
    assert.match(d8Body, /github-issues|gitlab-issues/i);
    assert.match(d8Body, /ci-parity|Dashboard v2/i);

    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const rtPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/runtime/package.json'), 'utf8'));
    const vsPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vscode-extension/package.json'), 'utf8'));
    const lockPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');

    const v = rootPkg.version;
    assert.ok(semver.valid(v) && semver.gte(v, '1.23.0'), `version must be >= 1.23.0, got ${v}`);
    assert.equal(rtPkg.version, v);
    assert.equal(vsPkg.version, v);
    assert.equal(lockPkg.version, v);
    assert.equal(lockPkg.packages[''].version, v);
    assert.ok(readme.includes(`**Versão:** \`${v}\``), `README.md must match version ${v}`);
    assert.match(changelog, new RegExp(`^[\\s\\S]{0,400}## \\[${v.replace(/\./g, '\\.')}\\]`));
    assert.match(changelog, /^## \[1\.23\.0\]/m, 'CHANGELOG.md must contain [1.23.0] section');
    assert.match(changelog, /^## \[1\.22\.2\]/m, 'CHANGELOG.md must preserve [1.22.2] section');

    // Workflow & config docs updated for 1.23.0
    const configDoc = fs.readFileSync(path.join(REPO_ROOT, 'oxe/templates/CONFIG.md'), 'utf8');
    const helpDoc = fs.readFileSync(path.join(REPO_ROOT, 'oxe/workflows/help.md'), 'utf8');
    const shipDoc = fs.readFileSync(path.join(REPO_ROOT, 'oxe/workflows/ship.md'), 'utf8');
    const execDoc = fs.readFileSync(path.join(REPO_ROOT, 'oxe/workflows/lean/execute.md'), 'utf8');
    assert.match(configDoc, /auto_lease|block_on_drift|auto_route|github-issues/i, 'oxe/templates/CONFIG.md must document 1.23.0 keys');
    assert.match(helpDoc, /oxe-cc mcp|ci-parity/i, 'oxe/workflows/help.md must document 1.23.0 commands');
    assert.match(shipDoc, /ci-parity|1\.23\.0|OIDC|reevaluate/i, 'oxe/workflows/ship.md must document 1.23.0 release/ship parity');
    assert.match(execDoc, /auto_lease|reevaluate|auto_route|1\.23\.0/i, 'oxe/workflows/lean/execute.md must document 1.23.0 loops');

    const readiness = releaseLib.inspectReleaseReadiness(REPO_ROOT, { packageRoot: REPO_ROOT });
    assert.equal(readiness.manifest.versions.rootPackage.version, v);
    assert.ok(
      !readiness.blockers.some((b) => /diverge da versão raiz/i.test(b)),
      `expected zero version-drift blockers, got: ${JSON.stringify(readiness.blockers)}`,
    );
  });
});
