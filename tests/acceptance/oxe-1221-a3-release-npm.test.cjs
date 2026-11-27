'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('v1.22.1 F1 A3 — OXB-221-03 (OB-27)', () => {
  it('A3: OXB-221-03 release.yml defines hardened publish-npm job with SHA-pinned actions, provenance, and npm view check', () => {
    const wfPath = path.join(ROOT, '.github', 'workflows', 'release.yml');
    const yml = fs.readFileSync(wfPath, 'utf8');
    assert.match(yml, /^\s{2}publish-npm:\s*$/m, 'release.yml must declare publish-npm job');
    const publishBlock = yml.slice(yml.indexOf('  publish-npm:'));
    assert.match(publishBlock, /needs:\s*\[validate,\s*create-release\]/, 'publish-npm must depend on validate and create-release');
    assert.match(publishBlock, /environment:\s*npm-release/, 'publish-npm must target npm-release environment');
    assert.match(publishBlock, /id-token:\s*write/, 'publish-npm must request id-token: write for OIDC provenance');
    assert.match(publishBlock, /npm publish[^\n]*--provenance[^\n]*--access public/, 'publish-npm must publish with --provenance --access public');
    assert.match(publishBlock, /npm view oxe-cc@/, 'publish-npm must verify published version via npm view');

    const usesLines = [...publishBlock.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
    assert.ok(usesLines.length >= 2, 'publish-npm must use checkout and setup-node');
    for (const u of usesLines) {
      assert.match(u, /@[0-9a-f]{40}$/, `Action must be SHA-pinned: ${u}`);
    }

    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'RELEASE-READINESS.md'), 'utf8');
    assert.match(doc, /Trusted Publishing|OIDC/i, 'RELEASE-READINESS.md must document OIDC Trusted Publishing');
  });
});
