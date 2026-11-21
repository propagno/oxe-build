'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const op = require('../bin/lib/oxe-operational.cjs');
const planJson = require('../bin/lib/oxe-plan-json.cjs');
const critCov = require('../bin/lib/oxe-criterion-coverage.cjs');
const turns = require('../bin/lib/oxe-turns.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');

const BIN = path.resolve(__dirname, '..', 'bin', 'oxe-cc.js');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxb-c21-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n\nFase atual: `spec_pending`\n');
  return dir;
}

describe('OXB-C21: 8 Wave-2 dogfooding gaps', () => {
  it('#1: oxe-cc session create|switch|list works, resolveRuntimeArtifactPaths scopes VERIFY.md inside session, and runtime compile --json emits valid JSON', () => {
    const dir = mkRepo();
    try {
      const created = JSON.parse(execFileSync(process.execPath, [BIN, 'session', 'create', 's001-oxe-57', '--title', 'OXE-57', '--dir', dir, '--json'], { encoding: 'utf8' }));
      assert.equal(created.active_session, 'sessions/s001-oxe-57');
      assert.equal(fs.existsSync(path.join(dir, '.oxe', 'sessions', 's001-oxe-57', 'SESSION.md')), true);

      const listed = JSON.parse(execFileSync(process.execPath, [BIN, 'session', 'list', '--dir', dir, '--json'], { encoding: 'utf8' }));
      assert.equal(listed.sessions.length, 1);
      assert.equal(listed.sessions[0].active, true);

      const paths = op.resolveRuntimeArtifactPaths(dir, 'sessions/s001-oxe-57');
      assert.match(paths.verify.replace(/\\/g, '/'), /\.oxe\/sessions\/s001-oxe-57\/verification\/VERIFY\.md$/);

      // minimal SPEC.md + PLAN.json inside session to verify `runtime compile --session ... --json`
      const sessSpecDir = path.join(dir, '.oxe', 'sessions', 's001-oxe-57', 'spec');
      fs.writeFileSync(path.join(sessSpecDir, 'SPEC.md'), '# SPEC — OXE-57\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | Funciona | node -e "process.exit(0)" |\n');
      const sessPlanDir = path.join(dir, '.oxe', 'sessions', 's001-oxe-57', 'plan');
      fs.writeFileSync(path.join(sessPlanDir, 'PLAN.md'), '# PLAN — OXE-57\n\n## Onda 1\n\n### T1 — Do thing\n');
      fs.writeFileSync(path.join(sessPlanDir, 'PLAN.json'), JSON.stringify({
        schema_version: 1,
        tasks: [{ id: 'T1', wave: 1, title: 'Do thing', files: ['README.md'], verify: { commands: ['node -e "process.exit(0)"'] }, acceptance: ['A1'] }],
      }, null, 2));
      const compiledRaw = execFileSync(process.execPath, [BIN, 'runtime', 'compile', '--dir', dir, '--session', 'sessions/s001-oxe-57', '--json'], { encoding: 'utf8' });
      const compiled = JSON.parse(compiledRaw);
      assert.equal(compiled.oxeRuntimeCompileSchema, 1);
      assert.equal(compiled.session, 'sessions/s001-oxe-57');
      assert.equal(compiled.nodes, 1);

      const switched = JSON.parse(execFileSync(process.execPath, [BIN, 'session', 'switch', '--none', '--dir', dir, '--json'], { encoding: 'utf8' }));
      assert.equal(switched.active_session, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#2: plan amend-test reports real lock previous_sha256 vs new disk sha256 (never identical when PLAN.json already had newSha), and plan.md documents frozen baseline commit', () => {
    const dir = mkRepo();
    try {
      const planMd = fs.readFileSync(path.resolve(__dirname, '..', 'oxe', 'workflows', 'plan.md'), 'utf8');
      assert.match(planMd, /oxe-cc session create/);
      assert.match(planMd, /test\(acceptance\): frozen tests/);

      const testFile = path.join(dir, 'tests', 'a1.test.js');
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, 'it("works", () => {});\n');
      const planJsonPath = path.join(dir, '.oxe', 'PLAN.json');
      const newSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const oldLockSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      fs.writeFileSync(planJsonPath, JSON.stringify({
        schema: 1,
        tasks: [{ id: 'T1', wave: 1, title: 'T1', files: ['src/a.js'], acceptance: ['A1'] }],
        acceptance_tests: [{ id: 'AT1', criterion: 'A1', files: ['tests/a1.test.js'], command: 'node --test tests/a1.test.js', sha256: newSha, hashes: { 'tests/a1.test.js': newSha } }],
      }, null, 2));
      const res = planJson.amendFrozenTestInPlanJson(path.join(dir, '.oxe', 'PLAN.md'), 'tests/a1.test.js', newSha, {
        reason: 'CR-F1-1',
        by: 'tech-lead',
        previous_sha256: oldLockSha,
      });
      assert.equal(res.ok, true);
      assert.equal(res.previous_sha256, oldLockSha);
      assert.notEqual(res.previous_sha256, res.sha256);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#3: plan lint proves accepts describe() titles, OXB-030 ignores Portuguese prose in backticks, and oxe-turns respects complexity: M', () => {
    const testSrc = `describe('StatusBar layout', () => {\n  it('renders height', () => {});\n});\n`;
    const titles = planJson.declaredTestTitles(testSrc, 'tests/sb.test.tsx', { includeSuites: true });
    assert.ok(titles.includes('StatusBar layout'), `expected describe title in ${JSON.stringify(titles)}`);
    assert.ok(titles.includes('renders height'));
    // spec freeze (default) keeps proves = the it/test titles only
    assert.deepEqual(planJson.declaredTestTitles(testSrc, 'tests/sb.test.tsx'), ['renders height']);

    const terms = critCov.verifiableTerms('A `barra de status` deve exibir `statusCode` 404 no `src/StatusBar.tsx`');
    assert.ok(!terms.includes('barra de status'), `must skip natural-language prose backticks, got ${JSON.stringify(terms)}`);
    assert.ok(terms.includes('statusCode'));
    assert.ok(terms.includes('404'));
    assert.ok(terms.includes('src/StatusBar.tsx'));

    // complexity: M should stay M (30 turns), not be silently reclassified as L (60 turns)
    const sz = turns.estimateSize({ id: 'T1', complexity: 'M', files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts'] });
    assert.equal(sz, 'M');
  });

  it('#4: --help works on second-level subcommands (ship check-origin --help, plan amend-test --help, plan lint --help)', () => {
    const h1 = execFileSync(process.execPath, [BIN, 'ship', 'check-origin', '--help'], { encoding: 'utf8' });
    assert.match(h1, /ship check-origin/);
    const h2 = execFileSync(process.execPath, [BIN, 'plan', 'amend-test', '--help'], { encoding: 'utf8' });
    assert.match(h2, /plan amend-test/);
    const h3 = execFileSync(process.execPath, [BIN, 'plan', 'lint', '--help'], { encoding: 'utf8' });
    assert.match(h3, /plan lint/);
  });

  it('#5 & #6 & #8: quick --from-card pre-populates objective, quick.md aligns step 7, pre-push prioritizes active quick over old session, and quick list marks active (*) with worktree/branch', async () => {
    const dir = mkRepo();
    try {
      const quickWorkflow = fs.readFileSync(path.resolve(__dirname, '..', 'oxe', 'workflows', 'quick.md'), 'utf8');
      assert.match(quickWorkflow, /--from-card <KEY>/);
      assert.match(quickWorkflow, /não edite manualmente os blocos gerenciados/i);

      // set an older active session in STATE.md
      fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n\nSessão ativa: `sessions/s001-oxe-57`\n');
      // create refine JSON for OXE-280
      fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'refine'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-280.json'), JSON.stringify({ key: 'OXE-280', summary: 'Corrigir badge de aprovação' }));

      const started = await op.runtimeQuick(dir, null, { action: 'start', fromCard: 'OXE-280', noAlm: true });
      assert.equal(started.key, 'OXE-280');
      assert.equal(started.objective, 'Corrigir badge de aprovação');

      // pre-push prioritizes active quick over old session
      const prePushOut = execFileSync(process.execPath, [BIN, 'runtime', 'pre-push', '--dir', dir], { encoding: 'utf8', input: '' });
      assert.match(prePushOut, new RegExp(`quick ${started.id}`));
      assert.doesNotMatch(prePushOut, /s001-oxe-57/);

      // quick list marks active (*) and shows worktree/branch
      const listOut = execFileSync(process.execPath, [BIN, 'quick', 'list', '--dir', dir], { encoding: 'utf8' });
      assert.match(listOut, new RegExp(`\\* ${started.id}`));
      assert.match(listOut, /\[.*main\]/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
