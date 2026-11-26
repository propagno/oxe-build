'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const preflight = require('../bin/lib/oxe-preflight.cjs');
const syncLib = require('../bin/lib/oxe-sync.cjs');
const shipPr = require('../bin/lib/oxe-ship-pr.cjs');
const train = require('../bin/lib/oxe-merge-train.cjs');
const ic = require('../bin/lib/oxe-integration-checks.cjs');

const BIN = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');

function mkGitRepo(prefix = 'oxe-1230-l2-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('v1.23.0 Lote 2 — Corte de retrabalho de CI (OXB-G09, G16, G10, G13, G14, G06, G07)', () => {
  it('OXB-G09 + OXB-G16 + OXB-G10: preflight runs cheap checks + path-triggered UI/perf regression checks and integrates with pre-push', () => {
    const dir = mkGitRepo('oxe-g09-');
    try {
      fs.mkdirSync(path.join(dir, 'src', 'ui'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'ui', 'Button.tsx'), 'export const Button = () => null;\n');
      fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({
        preflight: {
          checks: [
            { name: 'css-classes-guard', command: 'node -e "process.exit(0)"' },
            { name: 'env-clean', command: 'node -e "if (process.env.OXESPACE_LEAK) process.exit(2)"' },
          ],
          triggers: [
            { name: 'ui-regression', globs: ['src/ui/**'], command: 'node -e "process.exit(0)"' },
            { name: 'never-hit', globs: ['mobile/**'], command: 'node -e "process.exit(1)"' },
          ],
          runOnPrePush: true,
        },
      }));
      const prevLeak = process.env.OXESPACE_LEAK;
      process.env.OXESPACE_LEAK = 'should-be-stripped';
      try {
        const res = preflight.runPreflight(dir, { base: 'main', changedFiles: ['src/ui/Button.tsx'] });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.checks.length, 2);
        assert.equal(res.triggers.length, 1);
        assert.equal(res.triggers[0].name, 'ui-regression');
      } finally {
        if (prevLeak === undefined) delete process.env.OXESPACE_LEAK;
        else process.env.OXESPACE_LEAK = prevLeak;
      }

      // OXB-G16: pre-push fails when a cheap guard fails
      fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({
        preflight: {
          checks: [{ name: 'css-classes-guard', command: 'node -e "console.error(\'orphan token\'); process.exit(1)"' }],
          runOnPrePush: true,
        },
      }));
      const pp = ic.checkPrePush(dir, '');
      assert.equal(pp.ok, false);
      assert.match(pp.message, /preflight falhou.*css-classes-guard/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G13: preflight --e2e-impact detects removed data-testid and locale labels against e2e/** and flags frozen e2e/acceptance/** specs', () => {
    const dir = mkGitRepo('oxe-g13-');
    try {
      fs.mkdirSync(path.join(dir, 'e2e', 'acceptance'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'e2e', 'settings.spec.ts'), 'test("opens", async ({ page }) => { await page.getByTestId("settings-old-btn").click(); });\n');
      fs.writeFileSync(path.join(dir, 'e2e', 'acceptance', 'brd23-settings.spec.ts'), 'test("frozen", async ({ page }) => { await page.getByText("Advanced Preferences").click(); });\n');

      const fakeDiff = [
        '+++ b/src/components/Settings.tsx',
        '- <button data-testid="settings-old-btn">Save</button>',
        '+ <button data-testid="settings-new-btn">Save</button>',
        '+++ b/shared/locales/en/settings.json',
        '-   "advancedTitle": "Advanced Preferences",',
        '+   "advancedTitle": "System Preferences",',
      ].join('\n');

      const impact = preflight.detectE2eImpact(dir, { diffText: fakeDiff });
      assert.equal(impact.ok, false);
      assert.equal(impact.affected_specs.length, 2);
      assert.equal(impact.frozen_affected.length, 1);
      assert.equal(impact.frozen_affected[0].file, 'e2e/acceptance/brd23-settings.spec.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G14: ship status inspects marca/conformidade commit status (failing on enforced divergences even when job passed) and preflight alerts CSS edits on design targets', () => {
    const dir = mkGitRepo('oxe-g14-');
    try {
      // Part 1: commit status `marca/conformidade` with enforced divergences overrides green job
      const cs = shipPr.inspectRequiredCommitStatuses(dir, 'abc123', {
        commitStatuses: [
          { context: 'marca/conformidade', state: 'failure', description: '4 enforced divergences (BRD-03.tabs.height: 34.2px vs 32px)', target_url: 'https://ci/run/1' },
        ],
      });
      assert.equal(cs.ok, false);
      assert.equal(cs.failures.length, 1);
      assert.equal(cs.failures[0].enforced_divergences, 4);

      // Even if state were "success" with enforced divergences > 0 in description, it fails!
      const csMasked = shipPr.inspectRequiredCommitStatuses(dir, 'abc123', {
        commitStatuses: [
          { context: 'marca/conformidade', state: 'success', description: '2 enforced divergences detected' },
        ],
      });
      assert.equal(csMasked.ok, false);
      assert.equal(csMasked.failures[0].enforced_divergences, 2);

      // Part 2: CSS target risk detection against src/design/targets/brd-03.json
      fs.mkdirSync(path.join(dir, 'src', 'design', 'targets'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'design', 'targets', 'brd-03.json'), JSON.stringify({
        id: 'BRD-03',
        tabs: { selector: '.mode-switch-tab', height: 32 },
      }));
      fs.writeFileSync(path.join(dir, 'src', 'components', 'ModeSwitch.css'), '.mode-switch-tab { border: 1px solid red; height: 32px; }\n');
      const cssRisk = preflight.detectCssTargetRisk(dir, {
        diffText: '+++ b/src/components/ModeSwitch.css\n+ .mode-switch-tab { border: 1px solid red; }\n',
      });
      assert.equal(cssRisk.ok, false);
      assert.equal(cssRisk.alerts.length, 1);
      assert.equal(cssRisk.alerts[0].target_id, 'BRD-03');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G06: oxe-cc sync detects colliding SQLite migration numbers + numeric ratchets and applies deterministic auto-bump', () => {
    const dir = mkGitRepo('oxe-g06-');
    try {
      fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'migrations', '0105_init.sql'), '-- v105\n');
      fs.writeFileSync(path.join(dir, 'src', 'a.tsx'), '<button>x</button>\n');
      fs.writeFileSync(path.join(dir, 'tests', 'design-lint.test.ts'), 'const MAX_RAW_BUTTONS = 5;\n');
      fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({
        lint: {
          ratchets: [{ file: 'tests/design-lint.test.ts', pattern: 'MAX_RAW_BUTTONS\\s*=\\s*(\\d+)', paths: ['src/**'], counts: '<button', direction: 'down' }],
        },
      }));
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'base'], { cwd: dir, stdio: 'ignore' });

      // Branch adds migration 0106_feature.sql
      execFileSync('git', ['checkout', '-b', 'feat/mig'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'migrations', '0106_feature.sql'), '-- version = 106\nCREATE TABLE f(id INT);\n');
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'feat: add 0106_feature'], { cwd: dir, stdio: 'ignore' });

      // Meanwhile main also landed 0106_other.sql!
      execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'migrations', '0106_other.sql'), '-- other 106\n');
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'main: add 0106_other'], { cwd: dir, stdio: 'ignore' });

      execFileSync('git', ['checkout', 'feat/mig'], { cwd: dir, stdio: 'ignore' });

      // Dry-run via CLI detects both collision (0106 -> 0107) and ratchet (5 -> 1)
      const dry = JSON.parse(execFileSync(process.execPath, [BIN, 'sync', '--base', 'main', '--dir', dir, '--json'], { encoding: 'utf8' }));
      assert.equal(dry.dry_run, true);
      assert.equal(dry.migration_bumps.length, 1);
      assert.equal(dry.migration_bumps[0].from, 'migrations/0106_feature.sql');
      assert.equal(dry.migration_bumps[0].to, 'migrations/0107_feature.sql');
      assert.equal(dry.ratchet_updates.length, 1);
      assert.equal(dry.ratchet_updates[0].from, 5);
      assert.equal(dry.ratchet_updates[0].to, 1);

      // Apply executes rename + internal version update + ratchet recalculation
      const applied = syncLib.syncSequentialResources(dir, { base: 'main', apply: true, verify: 'node -e "process.exit(0)"' });
      assert.equal(applied.ok, true);
      assert.equal(fs.existsSync(path.join(dir, 'migrations', '0107_feature.sql')), true);
      assert.match(fs.readFileSync(path.join(dir, 'migrations', '0107_feature.sql'), 'utf8'), /version = 107/);
      assert.match(fs.readFileSync(path.join(dir, 'tests', 'design-lint.test.ts'), 'utf8'), /MAX_RAW_BUTTONS = 1;/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OXB-G07: merge train classifies 5xx / runner timeout / perf-recheck spike as transient and retries with exponential backoff without losing position', () => {
    assert.equal(train.classifyTrainFailure('HTTP 502 Bad Gateway from GitHub API').transient, true);
    assert.equal(train.classifyTrainFailure('HTTP 502 Bad Gateway from GitHub API').kind, 'github_5xx');
    assert.equal(train.classifyTrainFailure('perf-recheck noisy runner spike').transient, true);
    assert.equal(train.classifyTrainFailure('AssertionError: expected 1 to equal 2').transient, false);

    const sleeps = [];
    let calls = 0;
    const retryRes = train.runWithInfraRetry(() => {
      calls += 1;
      if (calls < 3) return { status: 1, stderr: 'HTTP 502 Bad Gateway' };
      return { status: 0, stdout: 'ok' };
    }, { backoffMs: [100, 200, 400], sleep: (ms) => sleeps.push(ms) });
    assert.equal(retryRes.ok, true);
    assert.equal(retryRes.attempts, 3);
    assert.deepEqual(sleeps, [100, 200]);

    // Real code failure does NOT retry!
    let codeCalls = 0;
    const codeFail = train.runWithInfraRetry(() => {
      codeCalls += 1;
      return { status: 1, stderr: 'TypeError: x is undefined' };
    }, { backoffMs: [100, 200], sleep: () => {} });
    assert.equal(codeFail.ok, false);
    assert.equal(codeCalls, 1);

    // retryIfTransient re-enqueues PR on transient 502 without manual ejection
    const ghCalls = [];
    const re = train.retryIfTransient({
      root: process.cwd(),
      item: { url: 'https://github.com/org/repo/pull/1187', note: 'removed: HTTP 502 Bad Gateway updating branch' },
      backoffMs: [10],
      sleep: () => {},
      spawn: (cmd, args) => { ghCalls.push([cmd, ...args]); return { status: 0, stdout: '', stderr: '' }; },
    });
    assert.equal(re.retried, true);
    assert.equal(re.kept_position, true);
    assert.equal(ghCalls.length, 1);
  });
});
