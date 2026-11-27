'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const alm = require('../../bin/lib/oxe-alm.cjs');
const almVcs = require('../../bin/lib/oxe-alm-vcs.cjs');
const onboard = require('../../bin/lib/oxe-onboard.cjs');

describe('A8 — ALM nativo para GitHub Issues (gh) e GitLab Issues (glab) (OXB-230-08)', () => {
  it('OXB-230-08: almConfig, almDoctor, almPush, almMove, almDefect and onboard support github-issues (gh) and gitlab-issues (glab) with dry-run safety and zero Jira calls', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-a8-'));
    try {
      assert.equal(typeof almVcs.githubIssuesProvider, 'function');
      assert.equal(typeof almVcs.gitlabIssuesProvider, 'function');
      assert.equal(typeof alm.almDoctor, 'function');
      assert.equal(typeof alm.almPush, 'function');
      assert.equal(typeof alm.almMove, 'function');
      assert.equal(typeof alm.almDefect, 'function');

      // Ensure Jira HTTP transport is NEVER touched
      const forbidHttp = () => { throw new Error('Jira/HTTP must NOT be called for github-issues / gitlab-issues'); };

      for (const spec of [
        { provider: 'github-issues', cli: 'gh', cfgKey: 'github_issues', repo: 'acme/platform' },
        { provider: 'gitlab-issues', cli: 'glab', cfgKey: 'gitlab_issues', repo: 'acme/platform' },
      ]) {
        const progDir = path.join(dir, spec.provider);
        fs.mkdirSync(progDir, { recursive: true });
        const rawConfig = {
          alm: {
            provider: spec.provider,
            program: 'demo',
            [spec.cfgKey]: { repo: spec.repo },
          },
        };

        // 1. almConfig + onboard detectAlmProfile
        const cfg = alm.almConfig(rawConfig);
        assert.equal(cfg.provider, spec.provider);
        assert.equal(cfg.p.repo, spec.repo);

        const onboardAlm = onboard.detectAlmProfile(dir, rawConfig, {});
        assert.equal(onboardAlm.configured, true);
        assert.equal(onboardAlm.provider, spec.provider);
        assert.equal(onboardAlm.project, spec.repo);

        // Mock CLI spawn for gh / glab
        const calls = [];
        let issueSeq = 100;
        const mockSpawn = (bin, args) => {
          calls.push({ bin, args });
          assert.equal(bin, spec.cli, `expected CLI ${spec.cli}, got ${bin}`);
          if (args.includes('--version')) return { status: 0, stdout: `${spec.cli} version 2.50.0`, stderr: '' };
          if (args.includes('list')) return { status: 0, stdout: '[]', stderr: '' };
          if (args.includes('create')) {
            issueSeq += 1;
            const url = spec.provider === 'github-issues'
              ? `https://github.com/${spec.repo}/issues/${issueSeq}`
              : `https://gitlab.com/${spec.repo}/-/issues/${issueSeq}`;
            return { status: 0, stdout: `${url}\n`, stderr: '' };
          }
          if (args.includes('view')) {
            return { status: 0, stdout: JSON.stringify({ number: issueSeq, iid: issueSeq, state: 'OPEN', labels: [{ name: 'stage:intake' }] }), stderr: '' };
          }
          return { status: 0, stdout: 'ok\n', stderr: '' };
        };

        // 2. almDoctor checks CLI availability
        const doc = alm.almDoctor(cfg, { spawn: mockSpawn });
        assert.equal(doc.ok, true, `${spec.provider} almDoctor failed: ${JSON.stringify(doc)}`);
        assert.equal(doc.cli, spec.cli);

        // 3. almPush in --dry-run mode MUST NOT execute mutating create calls
        calls.length = 0;
        const pushDry = await alm.almPush(
          progDir,
          cfg,
          { stories: [{ id: 'US-1', persona: 'dev', want: 'entregar feature', benefit: 'valor', criteria: ['A1'], requirements: ['R1'] }], tasks: [], phase: 'F1', dryRun: true },
          { spawn: mockSpawn, http: forbidHttp, sleep: async () => {} }
        );
        assert.equal(pushDry.planned.length, 1);
        assert.equal(calls.some((c) => c.args.includes('create')), false, '--dry-run must never create remote issues');

        // 4. almPush with apply (dryRun: false) creates via gh / glab
        const pushReal = await alm.almPush(
          progDir,
          cfg,
          { stories: [{ id: 'US-1', persona: 'dev', want: 'entregar feature', benefit: 'valor', criteria: ['A1'], requirements: ['R1'] }], tasks: [], phase: 'F1', dryRun: false },
          { spawn: mockSpawn, http: forbidHttp, sleep: async () => {}, apply: true }
        );
        assert.equal(pushReal.created.length, 1);
        const createdKey = pushReal.created[0].key;
        assert.ok(createdKey, 'created issue must have a key');

        // 5. almMove transitions via stage label & close on released
        const mv = await alm.almMove(progDir, cfg, 'US-1', 'released', { spawn: mockSpawn, http: forbidHttp, apply: true });
        assert.equal(mv.key, createdKey);
        assert.ok(calls.some((c) => c.args.includes('close') || c.args.includes('edit') || c.args.includes('update')), `${spec.provider} move must invoke CLI transition`);

        // 6. almDefect creates bug issue linked to origin
        const def = await alm.almDefect(progDir, cfg, { ref: 'DEF-1', title: 'Regressão pós-deploy', origin: 'US-1' }, { spawn: mockSpawn, http: forbidHttp, apply: true });
        assert.equal(def.created, true);
        assert.ok(def.key);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
