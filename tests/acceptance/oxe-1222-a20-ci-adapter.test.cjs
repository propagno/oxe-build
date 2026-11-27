'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ciAdapter = require('../../bin/lib/oxe-ci-adapter.cjs');
const shipPr = require('../../bin/lib/oxe-ship-pr.cjs');
const releaseOps = require('../../bin/lib/oxe-release-ops.cjs');
const oxeOp = require('../../bin/lib/oxe-operational.cjs');

function mkDirWithRemote(remoteUrl, extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a20-'));
  if (remoteUrl) {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'config'), `[remote "origin"]\n\turl = ${remoteUrl}\n`, 'utf8');
  }
  for (const [rel, body] of Object.entries(extraFiles)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return dir;
}

describe('A20 — CiAdapter provider-agnóstico para ship e release (OXB-222-20)', () => {
  it('OXB-222-20: resolveCiAdapter abstracts github, gitlab, azure-devops, and local with clean offline fallback in ship and release', () => {
    const ghDir = mkDirWithRemote('https://github.com/acme/demo.git', { '.github/workflows/ci.yml': 'on: push\n' });
    const glDir = mkDirWithRemote('https://gitlab.com/acme/demo.git', { '.gitlab-ci.yml': 'stages: [test]\n' });
    const azDir = mkDirWithRemote('https://dev.azure.com/acme/proj/_git/demo', { 'azure-pipelines.yml': 'trigger: [main]\n' });
    const localDir = mkDirWithRemote(null);
    try {
      // 1. Provider detection
      assert.equal(ciAdapter.detectCiProvider(ghDir), 'github');
      assert.equal(ciAdapter.detectCiProvider(glDir), 'gitlab');
      assert.equal(ciAdapter.detectCiProvider(azDir), 'azure-devops');
      assert.equal(ciAdapter.detectCiProvider(localDir), 'local');

      // 2. GitHub adapter via injected spawn (gh)
      const ghCalls = [];
      const ghSpawn = (bin, args) => {
        ghCalls.push([bin, ...args]);
        if (args[0] === 'pr' && args[1] === 'list') {
          return { status: 0, stdout: JSON.stringify([{ number: 42, title: 'feat: gh', headRefName: 'feat/x', state: 'OPEN', url: 'https://github.com/acme/demo/pull/42', labels: [] }]) };
        }
        if (args[0] === 'release' && args[1] === 'view') {
          return { status: 0, stdout: JSON.stringify({ tagName: 'v1.0.0', isDraft: false, assets: [{ name: 'app.exe' }] }) };
        }
        if (args[0] === 'run' && args[1] === 'list') {
          return { status: 0, stdout: JSON.stringify([{ databaseId: 99, status: 'completed', conclusion: 'success', url: 'https://github.com/acme/demo/actions/runs/99' }]) };
        }
        return { status: 0, stdout: '[]' };
      };
      const ghAdapter = ciAdapter.resolveCiAdapter(ghDir, { spawn: ghSpawn });
      assert.equal(ghAdapter.provider, 'github');
      const ghPrs = ghAdapter.listPullRequests({ state: 'open' });
      assert.equal(ghPrs.ok, true);
      assert.equal(ghPrs.items[0].number, 42);
      const ghRuns = ghAdapter.inspectCiStatus({ branch: 'feat/x' });
      assert.equal(ghRuns.ok, true);
      assert.equal(ghRuns.runs.length, 1);
      const ghRel = ghAdapter.listReleaseAssets('v1.0.0');
      assert.equal(ghRel.ok, true);
      assert.equal(ghRel.assets[0].name, 'app.exe');
      assert.ok(ghCalls.every((c) => c[0] === 'gh'));

      // 3. GitLab adapter via injected spawn (glab — NEVER invokes gh!)
      const glCalls = [];
      const glSpawn = (bin, args) => {
        glCalls.push([bin, ...args]);
        if (args[0] === 'mr') {
          return { status: 0, stdout: JSON.stringify([{ iid: 7, title: 'feat: gl', source_branch: 'feat/gl', state: 'opened', web_url: 'https://gitlab.com/acme/demo/-/merge_requests/7', labels: ['ready'] }]) };
        }
        if (args[0] === 'ci') {
          return { status: 0, stdout: JSON.stringify([{ id: 501, status: 'success', web_url: 'https://gitlab.com/acme/demo/-/pipelines/501' }]) };
        }
        if (args[0] === 'release') {
          return { status: 0, stdout: JSON.stringify({ tag_name: 'v1.0.0', assets: { links: [{ name: 'demo.tar.gz', url: 'https://gitlab.com/demo.tar.gz' }] } }) };
        }
        return { status: 0, stdout: '[]' };
      };
      const glAdapter = ciAdapter.resolveCiAdapter(glDir, { spawn: glSpawn });
      assert.equal(glAdapter.provider, 'gitlab');
      const glMrs = glAdapter.listPullRequests({ state: 'open' });
      assert.equal(glMrs.ok, true);
      assert.equal(glMrs.items[0].number, 7);
      const glRuns = glAdapter.inspectCiStatus({ branch: 'feat/gl' });
      assert.equal(glRuns.ok, true);
      assert.equal(glRuns.runs[0].conclusion, 'success');
      const glAssets = glAdapter.listReleaseAssets('v1.0.0');
      assert.equal(glAssets.ok, true);
      assert.equal(glAssets.assets[0].name, 'demo.tar.gz');
      assert.ok(glCalls.every((c) => c[0] === 'glab'), `GitLab adapter must only invoke glab, got: ${JSON.stringify(glCalls)}`);

      // 4. Azure DevOps adapter via injected spawn (az — NEVER invokes gh!)
      const azCalls = [];
      const azSpawn = (bin, args) => {
        azCalls.push([bin, ...args]);
        if (args.includes('pr')) {
          return { status: 0, stdout: JSON.stringify([{ pullRequestId: 12, title: 'feat: az', sourceRefName: 'refs/heads/feat/az', status: 'active', url: 'https://dev.azure.com/acme/proj/_git/demo/pullrequest/12' }]) };
        }
        if (args.includes('runs')) {
          return { status: 0, stdout: JSON.stringify([{ id: 700, status: 'completed', result: 'succeeded', url: 'https://dev.azure.com/acme/proj/_build/results?buildId=700' }]) };
        }
        return { status: 0, stdout: '[]' };
      };
      const azAdapter = ciAdapter.resolveCiAdapter(azDir, { spawn: azSpawn });
      assert.equal(azAdapter.provider, 'azure-devops');
      assert.equal(azAdapter.listPullRequests().items[0].number, 12);
      assert.equal(azAdapter.inspectCiStatus().runs[0].conclusion, 'success');
      assert.ok(azCalls.every((c) => c[0] === 'az'));

      // 5. Local adapter: 100% offline, 0 subprocesses spawned
      let localSpawned = 0;
      const localAdapter = ciAdapter.resolveCiAdapter(localDir, { spawn: () => { localSpawned += 1; throw new Error('must not spawn'); } });
      assert.equal(localAdapter.provider, 'local');
      assert.equal(localAdapter.listPullRequests().offline, true);
      assert.equal(localAdapter.inspectCiStatus().offline, true);
      assert.equal(localAdapter.listReleaseAssets('v1.0.0').offline, true);
      assert.equal(localSpawned, 0);

      // 6. Integration with ship (oxe-ship-pr.cjs), release (oxe-release-ops.cjs), and operational SDK
      const shipLocal = shipPr.status(localDir, { repo: true }, { provider: 'local' });
      assert.equal(shipLocal.provider, 'local');
      assert.equal(shipLocal.offline, true);
      assert.deepEqual(shipLocal.prs, []);

      const shipGl = shipPr.status(glDir, { repo: true }, { provider: 'gitlab', spawn: glSpawn });
      assert.equal(shipGl.provider, 'gitlab');
      assert.equal(shipGl.prs.length, 1);
      assert.equal(shipGl.prs[0].pr, 7);

      const relGl = releaseOps.fetchReleaseAssets(glDir, 'v1.0.0', { provider: 'gitlab', spawn: glSpawn });
      assert.equal(relGl.ok, true);
      assert.equal(relGl.provider, 'gitlab');
      assert.equal(relGl.assets[0].name, 'demo.tar.gz');

      assert.equal(typeof oxeOp.runtimeCiAdapterStatus, 'function');
      const sdkStatus = oxeOp.runtimeCiAdapterStatus(localDir);
      assert.equal(sdkStatus.provider, 'local');
      assert.equal(sdkStatus.offline, true);
    } finally {
      fs.rmSync(ghDir, { recursive: true, force: true });
      fs.rmSync(glDir, { recursive: true, force: true });
      fs.rmSync(azDir, { recursive: true, force: true });
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});
