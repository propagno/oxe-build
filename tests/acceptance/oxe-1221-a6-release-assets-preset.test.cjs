'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const releaseOps = require('../../bin/lib/oxe-release-ops.cjs');

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkProject(prefix, cfg) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  fs.mkdirSync(path.join(d, '.oxe'), { recursive: true });
  if (cfg) fs.writeFileSync(path.join(d, '.oxe', 'config.json'), JSON.stringify(cfg, null, 2));
  return d;
}

const ALL_GATES = {
  'hml-packaged-pass': true,
  'perf-gate': true,
  'packaged-smoke': true,
  acceptance: true,
};

describe('A6 (OB-30 / OXB-221-06): preset-driven release assets policy in oxe-release-ops.cjs', () => {
  it('cli preset does not require Desktop installer or Android APK in checkReleaseReadiness and finalizeRelease', async () => {
    const dir = mkProject('oxe-a6-cli-', { preset: 'cli' });

    const ready = await releaseOps.checkReleaseReadiness(dir, {
      version: '1.22.1',
      gates: ALL_GATES,
      assets: [{ name: 'oxe-agents-1.22.1.vsix' }],
    });
    assert.equal(ready.ok, true, `cli preset should not block on .apk/.exe: ${JSON.stringify(ready.blockers)}`);
    assert.equal(ready.assets.ok, true);
    assert.deepEqual(ready.assets.missing, []);

    const fin = await releaseOps.finalizeRelease(dir, {
      version: '1.22.1',
      assets: [{ name: 'oxe-cc-1.22.1.tgz' }],
    });
    assert.equal(fin.ok, true, `cli preset finalizeRelease should pass without .apk/.exe: ${JSON.stringify(fin.errors)}`);
  });

  it('desktop-mobile preset and legacy no-preset keep enforcing Desktop + Android APK + checksums', async () => {
    const desktopDir = mkProject('oxe-a6-dm-', { preset: 'desktop-mobile' });
    const badDm = await releaseOps.checkReleaseReadiness(desktopDir, {
      version: '1.22.1',
      gates: ALL_GATES,
      assets: [{ name: 'app-1.22.1-setup.exe' }],
    });
    assert.equal(badDm.ok, false);
    assert.ok(badDm.blockers.some((b) => /Android APK/i.test(b)));

    const legacyDir = mkProject('oxe-a6-legacy-', {});
    const badLegacy = await releaseOps.checkReleaseReadiness(legacyDir, {
      version: '1.22.1',
      gates: ALL_GATES,
      assets: [{ name: 'app-1.22.1-setup.exe' }],
    });
    assert.equal(badLegacy.ok, false);
    assert.ok(badLegacy.blockers.some((b) => /Android APK/i.test(b)));
  });

  it('explicit release.expectedAssets overrides preset defaults', async () => {
    const dir = mkProject('oxe-a6-override-', {
      preset: 'cli',
      release: {
        expectedAssets: [{ label: 'VSIX extension', patterns: ['*.vsix'] }],
      },
    });
    const missing = await releaseOps.checkReleaseReadiness(dir, {
      version: '1.22.1',
      gates: ALL_GATES,
      assets: [{ name: 'notes.txt' }],
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.blockers.some((b) => /VSIX extension/i.test(b)));

    const ok = await releaseOps.checkReleaseReadiness(dir, {
      version: '1.22.1',
      gates: ALL_GATES,
      assets: [{ name: 'oxe-agents-1.22.1.vsix' }],
    });
    assert.equal(ok.ok, true, JSON.stringify(ok.blockers));
  });
});
