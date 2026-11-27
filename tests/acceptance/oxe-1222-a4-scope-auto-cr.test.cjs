'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const changeLib = require('../../bin/lib/oxe-change.cjs');

const BIN = path.resolve(__dirname, '..', '..', 'bin', 'oxe-cc.js');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkPlanProject(prefix = 'oxe-1222-a4-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ profile: 'lean' }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    phase: 'F1',
    tasks: [
      {
        id: 'T1',
        title: 'implement policy writer',
        wave: 1,
        done: true,
        files: ['src/policy.js'],
        acceptance: ['A1'],
        verify: { commands: ['node --test tests/acceptance/a1.test.cjs'] },
      },
    ],
    acceptance_tests: [
      { criterion: 'A1', files: ['tests/acceptance/a1.test.cjs'], command: 'node --test tests/acceptance/a1.test.cjs' },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify({
    schema_version: 1,
    tasks: [
      {
        id: 'T1',
        exact_paths: ['src/policy.js'],
        symbols: [],
        contracts: [],
        expected_checks: ['node --test tests/acceptance/a1.test.cjs'],
      },
    ],
  }, null, 2));
  return dir;
}

describe('A4 — OXB-222-04: plan scope add --auto-cr atomic post-CI scope amendment', () => {
  it('OXB-222-04: plan scope add --auto-cr creates CR, reopens done task, and updates PLAN + PACK atomically', () => {
    const dir = mkPlanProject('oxe-1222-a4-ok-');

    const res = spawnSync(
      process.execPath,
      [
        BIN, 'plan', 'scope', 'add',
        '--task', 'T1',
        '--add-file', 'shared/mcp-coverage.js',
        '--add-file', 'services/policy/worktree-template-writer.js',
        '--auto-cr',
        '--by', 'executor',
        '--reason', 'CI mcp-coverage requires updating shared registry after initial fix',
        '--dir', dir,
        '--json',
      ],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const out = JSON.parse(res.stdout);
    assert.equal(out.task, 'T1');
    assert.equal(out.auto_cr_created, true);
    assert.equal(out.reopened, true);
    assert.equal(out.pack_updated, true);
    assert.match(out.cr, /^CR-\d+$/);
    assert.deepEqual(out.added, ['shared/mcp-coverage.js', 'services/policy/worktree-template-writer.js']);

    // PLAN.json updated & task reopened
    const planAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(planAfter.tasks[0].done, false);
    assert.ok(planAfter.tasks[0].files.includes('shared/mcp-coverage.js'));
    assert.ok(planAfter.tasks[0].files.includes('services/policy/worktree-template-writer.js'));

    // IMPLEMENTATION-PACK.json updated atomically
    const packAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    assert.ok(packAfter.tasks[0].exact_paths.includes('shared/mcp-coverage.js'));
    assert.ok(packAfter.tasks[0].exact_paths.includes('services/policy/worktree-template-writer.js'));

    // CR recorded in changes.ndjson
    const changes = changeLib.listChanges(path.join(dir, '.oxe', 'program'));
    const created = changes.find((c) => c.id === out.cr);
    assert.ok(created, 'auto-created CR must exist in changes.ndjson');
    assert.equal(created.status, 'open');
    assert.deepEqual(created.tasks, ['T1']);
  });

  it('OXB-222-04: plan scope add --auto-cr still refuses frozen acceptance test paths without mutating state', () => {
    const dir = mkPlanProject('oxe-1222-a4-frozen-');
    const res = spawnSync(
      process.execPath,
      [
        BIN, 'plan', 'scope', 'add',
        'T1', 'tests/acceptance/a1.test.cjs',
        '--auto-cr',
        '--by', 'executor',
        '--reason', 'attempt to add frozen test must fail cleanly',
        '--dir', dir,
        '--json',
      ],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    assert.notEqual(res.status, 0, 'must refuse frozen acceptance test');

    // No orphan CR created and T1 stays done
    const changes = changeLib.listChanges(path.join(dir, '.oxe', 'program'));
    assert.equal(changes.length, 0, 'must not create orphan CR on rejected frozen test');
    const planAfter = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.equal(planAfter.tasks[0].done, true, 'must not reopen T1 when request is rejected');
  });
});
