'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const syncLib = require('../../bin/lib/oxe-sync.cjs');
const op = require('../../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkGitRepo(prefix = 'oxe-1222-a3-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, 'electron', 'main', 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0108_base.sql'), '-- v108\n');
  fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'schema.ts'), [
    'export const LATEST_DB_VERSION = 108;',
    'export const EXPECTED_SCHEMA_VERSION = 108;',
  ].join('\n') + '\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init v108'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('A3 — OXB-222-03: oxe-cc sync version_pins, electron/main/db/migrations, and runtimePromote hook', () => {
  it('OXB-222-03: sync detects electron/main/db/migrations and bumps colliding migrations', () => {
    const dir = mkGitRepo('oxe-1222-a3-mig-');
    // Feature branch adds 0109_feat.sql
    execFileSync('git', ['checkout', '-b', 'feat/card'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0109_feat.sql'), '-- version: 109\n');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat 109'], { cwd: dir, stdio: 'ignore' });

    // Main advances with 0109_other.sql and 0110_other2.sql
    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0109_other.sql'), '-- v109\n');
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0110_other2.sql'), '-- v110\n');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'main 109+110'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', 'feat/card'], { cwd: dir, stdio: 'ignore' });

    const dry = syncLib.syncSequentialResources(dir, { base: 'main', apply: false });
    assert.equal(dry.migration_bumps.length, 1);
    assert.equal(dry.migration_bumps[0].from, 'electron/main/db/migrations/0109_feat.sql');
    assert.equal(dry.migration_bumps[0].to, 'electron/main/db/migrations/0111_feat.sql');
    assert.equal(dry.migration_bumps[0].new_number, 111);
  });

  it('OXB-222-03: sync.version_pins updates schema version constants atomically in dry-run and apply', () => {
    const dir = mkGitRepo('oxe-1222-a3-pins-');
    fs.writeFileSync(path.join(dir, 'oxe.config.json'), JSON.stringify({
      sync: {
        version_pins: [
          { file: 'electron/main/db/schema.ts', pattern: '(LATEST_DB_VERSION\\s*=\\s*)(\\d+)', label: 'LATEST_DB_VERSION' },
          { file: 'electron/main/db/schema.ts', pattern: '(EXPECTED_SCHEMA_VERSION\\s*=\\s*)(\\d+)', label: 'EXPECTED_SCHEMA_VERSION' },
        ],
      },
    }, null, 2));
    execFileSync('git', ['add', 'oxe.config.json'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add sync config'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', '-b', 'feat/pins'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0109_card.sql'), '-- version: 109\n');
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'schema.ts'), [
      'export const LATEST_DB_VERSION = 109;',
      'export const EXPECTED_SCHEMA_VERSION = 109;',
    ].join('\n') + '\n');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat 109 + pins'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0109_main.sql'), '-- v109\n');
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0110_main2.sql'), '-- v110\n');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'main 109+110'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', 'feat/pins'], { cwd: dir, stdio: 'ignore' });

    const dry = syncLib.syncSequentialResources(dir, { base: 'main', apply: false });
    assert.ok(Array.isArray(dry.version_pin_updates) && dry.version_pin_updates.length === 2, 'dry-run must plan both version_pins');
    assert.deepEqual(dry.version_pin_updates.map((u) => [u.from, u.to]), [[109, 111], [109, 111]]);
    assert.match(fs.readFileSync(path.join(dir, 'electron', 'main', 'db', 'schema.ts'), 'utf8'), /LATEST_DB_VERSION = 109;/, 'dry-run must not mutate file');

    const applied = syncLib.syncSequentialResources(dir, { base: 'main', apply: true });
    assert.equal(applied.applied_migrations.length, 1);
    assert.equal(applied.applied_version_pins.length, 2);
    assert.ok(fs.existsSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0111_card.sql')));
    const schemaAfter = fs.readFileSync(path.join(dir, 'electron', 'main', 'db', 'schema.ts'), 'utf8');
    assert.match(schemaAfter, /LATEST_DB_VERSION = 111;/);
    assert.match(schemaAfter, /EXPECTED_SCHEMA_VERSION = 111;/);
  });

  it('OXB-222-03: runtimePromote hooks oxe-sync to reconcile sequential migrations and version_pins', () => {
    const dir = mkGitRepo('oxe-1222-a3-promote-');
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
      profile: 'lean',
      sync: {
        on_promote: true,
        version_pins: [
          { file: 'electron/main/db/schema.ts', pattern: '(LATEST_DB_VERSION\\s*=\\s*)(\\d+)', label: 'LATEST_DB_VERSION' },
          { file: 'electron/main/db/schema.ts', pattern: '(EXPECTED_SCHEMA_VERSION\\s*=\\s*)(\\d+)', label: 'EXPECTED_SCHEMA_VERSION' },
        ],
      },
    }, null, 2));
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'oxe config'], { cwd: dir, stdio: 'ignore' });

    // Create program branch with T1 adding migration 0109_task.sql + schema.ts = 109
    execFileSync('git', ['checkout', '-b', 'prog/f1'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({
      schema_version: 1,
      tasks: [
        {
          id: 'T1',
          title: 'add migration',
          wave: 1,
          done: true,
          files: ['electron/main/db/migrations/0109_task.sql', 'electron/main/db/schema.ts'],
          acceptance: ['A1'],
          verify: { commands: ['node -e "process.exit(0)"'] },
        },
      ],
      acceptance_tests: [],
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0109_task.sql'), '-- version: 109\n');
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'schema.ts'), [
      'export const LATEST_DB_VERSION = 109;',
      'export const EXPECTED_SCHEMA_VERSION = 109;',
    ].join('\n') + '\n');
    execFileSync('git', ['add', 'electron/main/db/migrations/0109_task.sql', 'electron/main/db/schema.ts'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat: add migration 109\n\nOXE-Task: T1'], { cwd: dir, stdio: 'ignore' });

    // Advance main with colliding 0109_main.sql (different filename -> no git merge conflict on migration, only logical collision!)
    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'electron', 'main', 'db', 'migrations', '0109_main.sql'), '-- v109 main\n');
    execFileSync('git', ['add', 'electron/main/db/migrations/0109_main.sql'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'main adds 0109_main'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', 'prog/f1'], { cwd: dir, stdio: 'ignore' });

    const promoted = op.runtimePromote(dir, null, {
      task: 'T1',
      base: 'main',
      noFetch: true,
      noPrReady: true,
      integrationChecks: false,
      openPr: false,
    });

    assert.equal(promoted.conflict, null, promoted.error || '');
    assert.equal(promoted.error, undefined, promoted.error || '');
    assert.ok(promoted.sync && promoted.sync.applied_migrations.length === 1, `runtimePromote must report applied sync bumps: ${JSON.stringify(promoted.sync)}`);
    assert.equal(promoted.sync.applied_migrations[0].to, 'electron/main/db/migrations/0110_task.sql');
    assert.equal(promoted.sync.applied_version_pins.length, 2);

    // Inspect promoted branch contents directly
    const treeList = execFileSync('git', ['ls-tree', '-r', '--name-only', promoted.branch], { cwd: dir, encoding: 'utf8' });
    assert.match(treeList, /electron\/main\/db\/migrations\/0110_task\.sql/);
    assert.doesNotMatch(treeList, /electron\/main\/db\/migrations\/0109_task\.sql/);
    const promotedSchema = execFileSync('git', ['show', `${promoted.branch}:electron/main/db/schema.ts`], { cwd: dir, encoding: 'utf8' });
    assert.match(promotedSchema, /LATEST_DB_VERSION = 110;/);
    assert.match(promotedSchema, /EXPECTED_SCHEMA_VERSION = 110;/);
  });
});
