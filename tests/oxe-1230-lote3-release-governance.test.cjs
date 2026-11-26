'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const autoresume = require('../bin/lib/oxe-autoresume.cjs');
const acceptanceAudit = require('../bin/lib/oxe-acceptance-audit.cjs');
const releaseOps = require('../bin/lib/oxe-release-ops.cjs');
const almPrs = require('../bin/lib/oxe-alm-prs.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

const BIN = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');

describe('v1.23.0 Lote 3 — Governança de release & resiliência (OXB-G04, G05, G08, G17, G11)', () => {
  it('OXB-G04: reconcileOrphansAndResumePlan reconciles dead-PID leases, removes expired locks, detects committed checkpoints, and resumes at the next pending task', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g04-'));
    try {
      const runsDir = path.join(dir, '.oxe', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });
      const lFile = autoresume.leasePath(runsDir);
      autoresume.startLease(lFile, {
        pid: 999991,
        argv: ['runtime', 'execute', '--dir', dir],
        cwd: dir,
      });
      // Stale dead-PID lock file
      const staleLock = path.join(runsDir, 'scheduler.lock.json');
      fs.writeFileSync(staleLock, JSON.stringify({ pid: 999992, acquired_at: '2026-11-20T00:00:00Z' }));
      // PLAN.json with T1 committed in git checkpoint (not marked done yet) and T2 pending
      fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
        schema_version: 1,
        tasks: [
          { id: 'T1', wave: 1, title: 'Task 1', done: false },
          { id: 'T2', wave: 1, title: 'Task 2', done: false },
        ],
      }));

      const rec = autoresume.reconcileOrphansAndResumePlan(dir, {
        alive: () => false,
        gitCommittedTasks: ['T1'],
        freeMb: 8192,
      });
      assert.equal(rec.ok, true);
      assert.equal(rec.reconciled_lease.reason, 'orphan_pid');
      assert.equal(rec.cleaned_locks.length, 1);
      assert.equal(fs.existsSync(staleLock), false, 'stale dead-PID lock must be removed');
      assert.deepEqual(rec.reconciled_checkpoints, ['T1']);
      assert.equal(rec.resume_task.id, 'T2');
      assert.equal(rec.can_resume, true);
      // Idempotent second call: lease already reconciled as crashed, still resumable at T2, no extra locks left
      const rec2 = autoresume.reconcileOrphansAndResumePlan(dir, {
        alive: () => false,
        gitCommittedTasks: ['T1'],
        freeMb: 8192,
      });
      assert.equal(rec2.cleaned_locks.length, 0);
      assert.equal(rec2.resume_task.id, 'T2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G05: oxe-cc acceptance-audit detects frozen specs testing cut requirements (e.g. B1.4) and broken relative imports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g05-'));
    try {
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'e2e', 'acceptance'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), [
        '# SPEC',
        '## Fora de escopo',
        '- B1.4 — persistência legada de conversas (cortado na 1.6.0)',
      ].join('\n'));
      fs.writeFileSync(
        path.join(dir, 'e2e', 'acceptance', 'S3-conversations-survive-restart.spec.ts'),
        'import { helper } from "../../src/removed-helper";\ntest("B1.4 survives restart", async () => {});\n'
      );

      const res = JSON.parse(execFileSync(process.execPath, [BIN, 'acceptance-audit', '--dir', dir, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || '{}');
      assert.ok(res);
    } catch (err) {
      // CLI exits 1 when errors > 0 — stdout still carries valid JSON!
      const parsed = JSON.parse(String(err.stdout || '{}'));
      assert.equal(parsed.ok, false);
      assert.equal(parsed.specs_scanned, 1);
      assert.ok(parsed.findings.some((f) => f.kind === 'cut_requirement_drift' && f.ref === 'B1.4'));
      assert.ok(parsed.findings.some((f) => f.kind === 'broken_import'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // Clean repo with valid frozen spec passes
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g05-ok-'));
    try {
      fs.mkdirSync(path.join(cleanDir, 'tests', 'acceptance'), { recursive: true });
      fs.writeFileSync(path.join(cleanDir, 'tests', 'acceptance', 'a1.test.js'), 'it("works", () => {});\n');
      const ok = acceptanceAudit.auditAcceptanceSpecs(cleanDir);
      assert.equal(ok.ok, true);
      assert.equal(ok.errors, 0);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it('OXB-G08: release-readiness reports board issues missing fixVersion / not Homologado, missing gates, and incomplete Desktop+Android assets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g08-'));
    try {
      const bad = await releaseOps.checkReleaseReadiness(dir, {
        version: '1.6.0',
        boardIssues: [
          { key: 'OXE-400', status: 'Homologado', fixVersions: [] },
          { key: 'OXE-401', status: 'In Progress', fixVersions: ['1.6.0'] },
          { key: 'OXE-402', status: 'Homologado', fixVersions: ['1.6.0'] },
        ],
        gates: { 'hml-packaged-pass': true, 'perf-gate': true, 'packaged-smoke': false, acceptance: true },
        assets: [{ name: 'oxespace-1.6.0-setup.exe' }], // missing Android APK & checksums!
      });
      assert.equal(bad.ok, false);
      assert.equal(bad.board.missing_fix_version.length, 1);
      assert.equal(bad.board.not_ready.length, 1);
      assert.ok(bad.blockers.some((b) => /packaged-smoke/i.test(b)));
      assert.ok(bad.blockers.some((b) => /Android APK/i.test(b)));

      const good = await releaseOps.checkReleaseReadiness(dir, {
        version: '1.6.0',
        boardIssues: [{ key: 'OXE-402', status: 'Homologado', fixVersions: ['1.6.0'] }],
        gates: { 'hml-packaged-pass': true, 'perf-gate': true, 'packaged-smoke': true, acceptance: true },
        assets: [{ name: 'oxespace-1.6.0-setup.exe' }, { name: 'oxespace-1.6.0.apk' }, { name: 'SHA256SUMS.txt' }],
      });
      assert.equal(good.ok, true, JSON.stringify(good.blockers));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G17: release-finalize verifies Desktop + Android APK + valid checksums, transitions Homologado cards to Lançado idempotently, and releases Jira version', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g17-'));
    try {
      const calls = [];
      let card1Status = 'Homologado';
      let versionReleased = false;
      const fakeJira = async (method, apiPath, body) => {
        calls.push({ method, apiPath, body });
        if (method === 'GET' && apiPath.startsWith('/rest/api/3/search/jql')) {
          return {
            issues: [
              { key: 'OXE-501', fields: { summary: 'A', status: { name: card1Status } } },
              { key: 'OXE-502', fields: { summary: 'B', status: { name: 'Lançado' } } },
            ],
          };
        }
        if (method === 'GET' && apiPath === '/rest/api/3/issue/OXE-501/transitions') {
          return { transitions: [{ id: '99', name: 'Lançado', to: { name: 'Lançado' } }] };
        }
        if (method === 'POST' && apiPath === '/rest/api/3/issue/OXE-501/transitions') {
          card1Status = 'Lançado';
          return {};
        }
        if (method === 'GET' && apiPath === '/rest/api/3/project/OXE/versions') {
          return [{ id: '10', name: '1.6.1', released: versionReleased }];
        }
        if (method === 'PUT' && apiPath === '/rest/api/3/version/10') {
          versionReleased = true;
          return { id: '10', released: true };
        }
        return {};
      };
      const sha = 'a'.repeat(64);
      const assets = [{ name: 'app-1.6.1.exe' }, { name: 'app-1.6.1.apk' }, { name: 'SHA256SUMS.txt' }];
      const checksumsText = `${sha}  app-1.6.1.exe\n${sha}  app-1.6.1.apk\n`;

      const res = await releaseOps.finalizeRelease(dir, {
        version: '1.6.1',
        project: 'OXE',
        site: 'https://jira.example',
        assets,
        checksumsText,
        jiraRequest: fakeJira,
        apply: true,
      });
      assert.equal(res.ok, true, JSON.stringify(res.errors));
      assert.deepEqual(res.transitioned, ['OXE-501']);
      assert.deepEqual(res.already_released, ['OXE-502']);
      assert.equal(res.version_released, true);

      // Idempotent second run transitions 0 cards and stays ok
      const res2 = await releaseOps.finalizeRelease(dir, {
        version: '1.6.1',
        project: 'OXE',
        site: 'https://jira.example',
        assets,
        checksumsText,
        jiraRequest: fakeJira,
        apply: true,
      });
      assert.equal(res2.ok, true);
      assert.deepEqual(res2.transitioned, []);
      assert.deepEqual(res2.already_released, ['OXE-501', 'OXE-502']);
      assert.equal(res2.version_released, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G11: OXE-Part-Of: KEY (k/N) holds card open until all parts land on main and checkEpicClosure detects when 100% of children are homologated', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-g11-'));
    try {
      const programDir = path.join(dir, '.oxe', 'program');
      fs.mkdirSync(programDir, { recursive: true });
      const cfg = alm.almConfig({ alm: { provider: 'jira', site: 'https://jira.example', project: 'OXE', states: { integrated: 'Na main', released: 'Done' } } });

      // Parse OXE-Part-Of: OXE-152 (1/2) even alongside OXE-Card: OXE-152 -> must NOT close yet!
      const m1 = almPrs.prMarkers(['feat: part A\n\nOXE-Card: OXE-152\nOXE-Part-Of: OXE-152 (1/2)'], cfg);
      assert.deepEqual(m1.closes, []);
      assert.deepEqual(m1.partial, ['OXE-152']);
      assert.equal(m1.parts[0].part, 1);
      assert.equal(m1.parts[0].total, 2);

      const moved = [];
      const commented = [];
      const fakeAlm = {
        stageAtOrPast: async () => ({ past: false }),
        move: async (_pd, _cfg, key, stage, opts) => { moved.push({ key, stage, comment: opts && opts.comment }); return { changed: true }; },
        comment: async (_pd, _cfg, key, text) => { commented.push({ key, text }); return {}; },
      };

      // PR #1 lands Part 1/2 -> commented only, NOT moved!
      const r1 = await almPrs.prMerged(dir, programDir, cfg, fakeAlm, {
        apply: true,
        prData: { number: 101, state: 'MERGED', title: 'OXE-152 Part A', branch: 'feat/152-a', body: 'OXE-Part-Of: OXE-152 (1/2)', url: 'https://gh/pr/101', commits: [] },
      });
      assert.equal(r1.moved.length, 0);
      assert.deepEqual(r1.commented, ['OXE-152']);
      assert.match(commented[0].text, /1\/2/);

      // PR #2 lands Part 2/2 -> ALL parts (2/2) landed -> auto-promotes OXE-152 to integrated!
      const r2 = await almPrs.prMerged(dir, programDir, cfg, fakeAlm, {
        apply: true,
        prData: { number: 102, state: 'MERGED', title: 'OXE-152 Part B', branch: 'feat/152-b', body: 'OXE-Part-Of: OXE-152 (2/2)', url: 'https://gh/pr/102', commits: [] },
      });
      assert.equal(r2.moved.length, 1);
      assert.equal(r2.moved[0].key, 'OXE-152');
      assert.match(moved[0].comment, /todas as partes \(2\/2\)/i);

      // Epic auto-close check
      const partialEpic = almPrs.checkEpicClosure('OXE-132', [
        { key: 'OXE-152', status: 'Homologado' },
        { key: 'OXE-153', status: 'In Progress' },
      ]);
      assert.equal(partialEpic.ready_to_close, false);
      assert.equal(partialEpic.open_children.length, 1);

      const readyEpic = await almPrs.syncEpicClosure(programDir, cfg, fakeAlm, 'OXE-132', {
        apply: true,
        children: [
          { key: 'OXE-152', status: 'Homologado' },
          { key: 'OXE-153', status: 'Lançado' },
        ],
      });
      assert.equal(readyEpic.ready_to_close, true);
      assert.equal(readyEpic.closed, true);
      assert.ok(moved.some((x) => x.key === 'OXE-132' && x.stage === 'released'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
