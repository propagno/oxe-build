'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const onboard = require('../../bin/lib/oxe-onboard.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

function mkRepo(prefix = 'oxe-a19-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'sample-app',
    version: '1.0.0',
    scripts: {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: 'node --test',
      build: 'vite build',
    },
  }, null, 2));
  return dir;
}

describe('A19 — Auto-configuração assistida via onboard --propose-config (OXB-222-19)', () => {
  it('OXB-222-19: proposeOnboardingConfig generates declarative phase_gates in --dry-run (0 writes) and merges non-destructively with --apply', () => {
    const ghDir = mkRepo('oxe-a19-gh-');
    const glDir = mkRepo('oxe-a19-gl-');
    try {
      // GitHub Actions repo with existing .oxe/config.json preserving user keys
      fs.mkdirSync(path.join(ghDir, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(ghDir, '.github', 'workflows', 'ci.yml'), [
        'name: CI',
        'on: [push]',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: npm run typecheck',
        '      - run: npm run lint',
        '      - run: npm test',
        '      - run: npm run build',
      ].join('\n'));
      fs.mkdirSync(path.join(ghDir, '.oxe'), { recursive: true });
      const initialCfg = {
        profile: 'balanced',
        custom_user_key: 'preserve-me',
        phase_gates: [
          { id: 'custom-lint', command: 'npm run lint' },
        ],
      };
      const cfgPath = path.join(ghDir, '.oxe', 'config.json');
      fs.writeFileSync(cfgPath, `${JSON.stringify(initialCfg, null, 2)}\n`, 'utf8');
      const beforeText = fs.readFileSync(cfgPath, 'utf8');

      // 1. Default --propose-config (dry-run): 0 disk writes
      const dry = onboard.proposeOnboardingConfig(ghDir, { dryRun: true });
      assert.equal(dry.ok, true);
      assert.equal(dry.dry_run, true);
      assert.equal(dry.applied, false);
      assert.equal(dry.proposed_patch.profile, 'lean');
      assert.ok(dry.proposed_patch.worktree && dry.proposed_patch.worktree.auto_gc, 'expected worktree.auto_gc proposal');
      assert.ok(Array.isArray(dry.added_gates) && dry.added_gates.length >= 2, `expected added_gates from CI, got: ${JSON.stringify(dry.added_gates)}`);
      assert.ok(dry.added_gates.some((g) => /typecheck/i.test(g.command)), 'expected typecheck gate proposed');
      assert.ok(!dry.added_gates.some((g) => g.command === 'npm run lint'), 'must not duplicate already-mirrored lint gate');
      assert.equal(fs.readFileSync(cfgPath, 'utf8'), beforeText, '--dry-run must perform 0 writes');

      // 2. CLI `oxe-cc onboard --propose-config --dry-run --json`
      const cliDry = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'onboard', '--propose-config', '--dry-run', '--dir', ghDir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(cliDry.oxeOnboardProposeSchema, 1);
      assert.equal(cliDry.dry_run, true);
      assert.equal(cliDry.applied, false);
      assert.equal(fs.readFileSync(cfgPath, 'utf8'), beforeText, 'CLI --propose-config without --apply must not write');

      // 3. CLI `oxe-cc onboard --propose-config --apply --json` merges non-destructively
      const cliApply = JSON.parse(execFileSync(
        process.execPath,
        [BIN, 'onboard', '--propose-config', '--apply', '--dir', ghDir, '--json'],
        { encoding: 'utf8' },
      ));
      assert.equal(cliApply.applied, true);
      assert.equal(cliApply.dry_run, false);
      const merged = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      assert.equal(merged.custom_user_key, 'preserve-me', 'existing user keys must be preserved');
      assert.equal(merged.profile, 'lean');
      assert.ok(merged.worktree && merged.worktree.auto_gc);
      assert.ok(merged.phase_gates.some((g) => g.id === 'custom-lint'), 'existing phase_gates must be preserved');
      assert.ok(merged.phase_gates.some((g) => /typecheck/i.test(g.command)), 'new CI phase_gates must be appended');

      // 4. Agnostic check: works equally on GitLab CI repo without .oxe/config.json
      fs.writeFileSync(path.join(glDir, '.gitlab-ci.yml'), [
        'test_job:',
        '  script:',
        '    - npm test',
        '    - npm run build',
      ].join('\n'));
      const glDry = onboard.proposeOnboardingConfig(glDir);
      assert.equal(glDry.dry_run, true);
      assert.ok(glDry.added_gates.some((g) => /npm test/i.test(g.command)));
      assert.equal(fs.existsSync(path.join(glDir, '.oxe', 'config.json')), false, 'default propose must remain dry-run');
    } finally {
      fs.rmSync(ghDir, { recursive: true, force: true });
      fs.rmSync(glDir, { recursive: true, force: true });
    }
  });
});
