'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('A1 — Hardening CI/release.yml: OIDC Node 24, retry npm view e Actions SHA-pinadas (OXB-230-01)', () => {
  it('OXB-230-01: release.yml runs publish-npm on Node 24 with OIDC + NPM_TOKEN fallback and async npm view retry loop, with updated SHA-pinned actions in release.yml and ci.yml', () => {
    const releaseYml = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8');
    const ciYml = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

    // 1. publish-npm uses Node 24 (npm >= 11.5.1 for OIDC Trusted Publishing), id-token: write, and NPM_TOKEN fallback
    const pubIdx = releaseYml.indexOf('publish-npm:');
    assert.ok(pubIdx >= 0, 'publish-npm job must exist in release.yml');
    const pubSection = releaseYml.slice(pubIdx);
    assert.match(pubSection, /node-version:\s*['"]?24['"]?/, 'publish-npm must use node-version 24 for OIDC Trusted Publishing');
    assert.match(pubSection, /id-token:\s*write/, 'publish-npm must request id-token: write');
    assert.match(pubSection, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/, 'publish-npm must retain NPM_TOKEN fallback');
    assert.match(pubSection, /npm publish --provenance --access public --ignore-scripts/);

    // 2. Verify published version step has a retry/backoff loop for async npm registry processing (202 Accepted)
    const verifyIdx = pubSection.indexOf('Verify published version on npm registry');
    assert.ok(verifyIdx >= 0, 'Verify published version step must exist');
    const verifySection = pubSection.slice(verifyIdx);
    assert.match(verifySection, /\b(for|while)\b/, 'Verify step must use a retry loop for async npm processing');
    assert.match(verifySection, /\bsleep\s+\d+/, 'Verify step must sleep between retries');
    assert.match(verifySection, /npm view oxe-cc@/, 'Verify step must query npm view oxe-cc@<version>');

    // 3. All `uses:` in both release.yml and ci.yml are full 40-hex SHA-pinned and upgraded off deprecated Node 20 SHAs
    const deprecatedShas = [
      '11bd71901bbe5b1630ceea73d27597364c9af683',
      '49933ea5288caeca8642d1e84afbd3f7d6820020',
      'ea165f8d65b6e75b540449e92b4886f43607fa02',
      'd3f86a106a0bac45b974a628896c90dbdf5c8093',
    ];
    for (const [name, body] of [['release.yml', releaseYml], ['ci.yml', ciYml]]) {
      const usesLines = [...body.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
      assert.ok(usesLines.length >= 4, `${name} must declare pinned actions`);
      for (const u of usesLines) {
        assert.match(u, /@[0-9a-f]{40}$/, `${name}: action ${u} must be pinned by 40-char commit SHA`);
        for (const oldSha of deprecatedShas) {
          assert.ok(!u.endsWith(oldSha), `${name}: action ${u} still uses deprecated Node 20 SHA ${oldSha}`);
        }
      }
    }
  });
});
