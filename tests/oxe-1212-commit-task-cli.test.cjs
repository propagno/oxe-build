'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');

// 1.21.2 — OXB-200: `oxe-cc runtime commit-task <Tn> [--by <agent|role>] [--skip-verify-if-fresh]`

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
};

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ct-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | t |\n| A2 | b | t |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Core\n\n**Depende de:** nenhuma\n**Critérios de aceite:** A2\n');
  write(dir, '.oxe/config.json', { external_dependency_check: false, checkpoint_commits: true });

  write(dir, 'src/feat.js', 'module.exports = { sum: (a, b) => 0 };\n');
  write(dir, 'src/second.js', 'module.exports = { mul: (a, b) => 0 };\n');
  write(dir, 'src/unrelated.js', 'module.exports = "untouched";\n');
  write(dir, 'tests/acceptance/a2-sum.test.js', [
    "const assert = require('node:assert/strict');",
    "const { sum } = require('../../src/feat.js');",
    'assert.equal(sum(2, 3), 5);',
    '',
  ].join('\n'));

  write(dir, '.oxe/PLAN.json', {
    schema_version: 1,
    phase: 'F2',
    acceptance_tests: [
      {
        criterion: 'A2',
        files: ['tests/acceptance/a2-sum.test.js'],
        command: 'node tests/acceptance/a2-sum.test.js',
        proves: ['sum works'],
      },
    ],
    tasks: [
      {
        id: 'T1',
        title: 'Implementar soma real',
        wave: 1,
        phase: 'F2',
        files: ['src/feat.js'],
        acceptance: ['A2'],
        verify: { commands: ['node tests/acceptance/a2-sum.test.js'] },
      },
      {
        id: 'T2',
        title: 'Implementar multiplicacao',
        wave: 1,
        phase: 'F2',
        files: ['src/second.js'],
        acceptance: ['A2'],
        verify: {
          commands: [
            'node -e "const fs=require(\'fs\'); fs.writeFileSync(\'.oxe/verify-ran-t2.flag\', \'1\'); if (require(\'./src/second.js\').mul(3,4)!==12) process.exit(1);"',
          ],
        },
      },
    ],
  });

  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F2');
  return dir;
}

describe('OXB-200: `oxe-cc runtime commit-task <Tn>` atomic CLI for external subagents & fallback', () => {
  it('commits only Tn.files with OXE-Task: <Phase>/<Tn>, leaves out-of-scope files uncommitted, marks PLAN.json done, and writes TaskCompleted + CheckpointCreated', () => {
    const dir = makeProject();

    // Implement T1 in scope AND dirty + stage an out-of-scope file (`src/unrelated.js`)
    write(dir, 'src/feat.js', 'module.exports = { sum: (a, b) => a + b };\n');
    write(dir, 'src/unrelated.js', 'module.exports = "dirty-outside-scope";\n');
    git(dir, 'add', 'src/unrelated.js');

    const res = spawnSync(
      process.execPath,
      [CLI, 'runtime', 'commit-task', 'T1', '--by', 'antigravity-backend', '--json', '--dir', dir],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.task, 'T1');
    assert.equal(parsed.phase, 'F2');
    assert.deepEqual(parsed.files, ['src/feat.js']);
    assert.ok(parsed.ignored_out_of_scope.includes('src/unrelated.js'));

    // Verify commit contains ONLY `src/feat.js` and carries `OXE-Task: F2/T1` trailer
    const committedNames = git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split(/\r?\n/);
    assert.deepEqual(committedNames, ['src/feat.js']);
    const commitMsg = git(dir, 'log', '-1', '--format=%B').stdout;
    assert.match(commitMsg, /OXE-Task: F2\/T1/);

    // Out-of-scope file was NOT committed to HEAD
    const headUnrelated = git(dir, 'show', 'HEAD:src/unrelated.js').stdout;
    assert.equal(headUnrelated, 'module.exports = "untouched";\n');

    // PLAN.json marked done with done_commit SHA
    const plan = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const t1 = plan.tasks.find((t) => t.id === 'T1');
    assert.equal(t1.done, true);
    assert.equal(t1.done_commit, parsed.commit);

    // OXE-EVENTS.ndjson contains CheckpointCreated + TaskCompleted (and no manual PlanTaskMarkedDone penalty)
    const events = op.readEvents(dir, null);
    const cpEv = events.find((e) => e.type === 'CheckpointCreated' && e.work_item_id === 'T1');
    const tcEv = events.find((e) => e.type === 'TaskCompleted' && e.work_item_id === 'T1');
    const wiEv = events.find((e) => e.type === 'WorkItemCompleted' && e.work_item_id === 'T1');
    assert.ok(cpEv, 'CheckpointCreated recorded in OXE-EVENTS.ndjson');
    assert.equal(cpEv.payload.commit, parsed.commit);
    assert.equal(cpEv.payload.by, 'antigravity-backend');
    assert.ok(tcEv, 'TaskCompleted recorded in OXE-EVENTS.ndjson');
    assert.equal(tcEv.payload.phase, 'F2');
    assert.ok(wiEv, 'WorkItemCompleted recorded for scorecard/dossier compatibility');
    assert.ok(!events.some((e) => e.type === 'PlanTaskMarkedDone'), 'does not incur manual intervention penalty');
  });

  it('rejects commit-task when a frozen acceptance test sha256 was tampered with', () => {
    const dir = makeProject();
    write(dir, 'src/feat.js', 'module.exports = { sum: (a, b) => a + b };\n');
    // Tamper with frozen acceptance test!
    write(dir, 'tests/acceptance/a2-sum.test.js', '// tampered!\n');

    const headBefore = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const res = spawnSync(
      process.execPath,
      [CLI, 'runtime', 'commit-task', 'T1', '--by', 'agent', '--dir', dir],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /acceptance_tampered/);
    assert.equal(git(dir, 'rev-parse', 'HEAD').stdout.trim(), headBefore, 'no commit created');
  });

  it('rejects commit-task when oxe-stub-check detects added stub markers', () => {
    const dir = makeProject();
    // Write implementation that passes sum(2,3)===5 OR has stub marker in added hunk
    write(dir, 'src/feat.js', [
      'function helper() { throw new Error("TODO: not implemented yet"); }',
      'module.exports = { sum: (a, b) => a + b, helper };',
      '',
    ].join('\n'));

    const headBefore = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const res = spawnSync(
      process.execPath,
      [CLI, 'runtime', 'commit-task', 'T1', '--by', 'agent', '--dir', dir],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /stub-check reprovou T1/);
    assert.equal(git(dir, 'rev-parse', 'HEAD').stdout.trim(), headBefore, 'no commit created');
  });

  it('supports --skip-verify-if-fresh when a recent green verify log exists for unchanged scope files', () => {
    const dir = makeProject();
    write(dir, 'src/second.js', 'module.exports = { mul: (a, b) => a * b };\n');

    // Simulate recent green verify log written after src/second.js was modified
    write(dir, '.oxe/tmp/T2/t2-verify.log', 'Test Files  1 passed (1)\nTests  2 passed (2)\n');

    const flagPath = path.join(dir, '.oxe', 'verify-ran-t2.flag');
    assert.equal(fs.existsSync(flagPath), false);

    const res = spawnSync(
      process.execPath,
      [CLI, 'runtime', 'commit-task', 'T2', '--by', 'subagent-fast', '--skip-verify-if-fresh', '--json', '--dir', dir],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.verify_skipped, true, 'skipped re-running verify command because fresh green log was present');
    assert.equal(fs.existsSync(flagPath), false, 'verify command process was indeed skipped');
  });
});
