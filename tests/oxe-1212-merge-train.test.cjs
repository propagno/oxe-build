'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const mt = require('../bin/lib/oxe-merge-train.cjs');

// 1.21.2 — OXB-102: merge-train awareness — a PR that left the train is re-synced; one on the train is never pushed.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

describe('OXB-102: merge train', () => {
  it('train state from labels and the latest merge-train comment', () => {
    assert.equal(mt.trainState({ state: 'OPEN', labels: [{ name: 'merge-train' }], comments: [{ body: 'merge-train: queued' }] }).state, 'queued');
    assert.equal(mt.trainState({ state: 'OPEN', comments: [{ body: 'merge-train: queued' }, { body: 'merge-train: car 3 testing' }] }).state, 'riding');
    assert.equal(mt.trainState({ state: 'OPEN', comments: [{ body: 'merge-train: car 3' }, { body: 'merge-train: removed (conflict with #612)' }] }).state, 'left');
    assert.equal(mt.trainState({ state: 'OPEN', labels: [{ name: 'merge-train:removed' }], comments: [] }).state, 'left');
    assert.equal(mt.trainState({ state: 'MERGED' }).state, 'merged');
  });

  it('sync --apply: the PR that left is reopened, merged with main, verified and pushed (no force); the queued one is not touched', () => {
    const remote = tmp('oxe-1212-mt-r-');
    git(remote, 'init', '-q', '--bare');
    const dir = tmp('oxe-1212-mt-');
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, 'src/a.js', '1\n');
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n\n### T1 — a\n\n- **Verificar:**\n  - Comando: `node -e 0`\n<!-- oxe-task: {"id":"T1","wave":1,"done":true} -->\n');
    write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], done: true, verify: { commands: ['node -e "process.exit(require(\'fs\').existsSync(\'src/main.js\')?0:1)"'] } }, { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], done: true, verify: { commands: ['node -e 0'] } }] }));
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    git(dir, 'remote', 'add', 'origin', remote); git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'checkout', '-qb', 'oxe/t1'); write(dir, 'src/a.js', '2\n'); git(dir, 'commit', '-qam', 'T1'); git(dir, 'push', '-q', 'origin', 'oxe/t1');
    git(dir, 'checkout', '-qb', 'oxe/t2', 'main'); write(dir, 'src/b.js', '2\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'T2'); git(dir, 'push', '-q', 'origin', 'oxe/t2');
    git(dir, 'checkout', '-q', 'main'); write(dir, 'src/main.js', 'nova base\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'main avança'); git(dir, 'push', '-q', 'origin', 'main');
    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T1', payload: { base: 'main', branch: 'oxe/t1', pr: 'https://github.com/o/r/pull/1' } });
    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T2', payload: { base: 'main', branch: 'oxe/t2', pr: 'https://github.com/o/r/pull/2' } });
    const ghCalls = [];
    const spawn = (cmd, args, opts) => {
      if (cmd === 'gh') {
        ghCalls.push(args.join(' '));
        if (args[1] === 'view') {
          const one = String(args[2]).endsWith('/1');
          return { status: 0, stdout: JSON.stringify({ state: 'OPEN', headRefName: one ? 'oxe/t1' : 'oxe/t2', url: args[2], labels: [], comments: [{ body: one ? 'merge-train: removed (stale base)' : 'merge-train: car 2' }] }) };
        }
        return { status: 0, stdout: '' };
      }
      return spawnSync(cmd, args, opts);
    };
    const st = op.runtimeTrain(dir, null, { spawn });
    assert.deepEqual(st.items.map((i) => [i.task, i.state]), [['T1', 'left'], ['T2', 'riding']]);
    const dry = op.runtimeTrain(dir, null, { action: 'sync', spawn });
    assert.deepEqual(dry.plan.map((p) => p.task), ['T1']);
    assert.equal(dry.applied, false);
    const out = op.runtimeTrain(dir, null, { action: 'sync', apply: true, spawn });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].ok, true, JSON.stringify(out.results[0]));
    assert.deepEqual(out.results[0].steps.map((s) => s.step), ['reopen', 'merge origin/main', 'verify', 'push (sem force)', 'relabel']);
    const remoteT1 = git(remote, 'log', '--format=%s', 'oxe/t1').stdout;
    assert.match(remoteT1, /Merge remote-tracking branch 'origin\/main'/);
    assert.equal(git(remote, 'log', '--format=%s', '-1', 'oxe/t2').stdout.trim(), 'T2', 'the PR on the train was not pushed');
    assert.ok(ghCalls.some((c) => /pr edit .*\/1 --remove-label merge-train:removed --add-label merge-train/.test(c)));
    assert.ok(!ghCalls.some((c) => /\/2 /.test(c) && /edit/.test(c)));
    const t1 = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8')).tasks[0];
    assert.equal(t1.done, false, 'T1 reopened');
    assert.equal(t1.reopened[0].by, 'merge-train');
  });

  it('sync --apply: auto-resolves cap-only ratchet conflict with main and recalculates cap = realCount before verify (OXB-C2 06:10Z)', () => {
    const remote = tmp('oxe-1212-mt-ratchet-r-');
    git(remote, 'init', '-q', '--bare');
    const dir = tmp('oxe-1212-mt-ratchet-');
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, 'src/a.tsx', 'export const A = () => "<div><button>1</button><button>2</button></div>";\n');
    write(dir, 'src/b.tsx', 'export const B = () => "<div><button>3</button><button>4</button></div>";\n');
    write(dir, 'tests/design-lint.test.ts', 'const RAW_BUTTON_CAP = 4;\n');
    write(dir, '.oxe/STATE.md', '# S\n');
    write(dir, '.oxe/PLAN.md', '# PLAN\n');
    write(dir, '.oxe/config.json', JSON.stringify({
      lint: {
        ratchets: [{
          file: 'tests/design-lint.test.ts',
          pattern: 'RAW_BUTTON_CAP = (\\d+)',
          counts: '<button\\b',
          paths: ['src/**/*.tsx'],
          direction: 'down',
        }],
      },
    }, null, 2));
    // Strict brd-01/brd-03 verify: requires RAW_BUTTON_CAP === exact <button> count in src/*.tsx!
    write(dir, 'scripts/check-ratchet.cjs', [
      "const fs = require('fs');",
      "const cap = Number(/RAW_BUTTON_CAP = (\\d+)/.exec(fs.readFileSync('tests/design-lint.test.ts', 'utf8'))[1]);",
      "const all = [fs.readFileSync('src/a.tsx', 'utf8'), fs.readFileSync('src/b.tsx', 'utf8')].join('\\n');",
      'const cnt = (all.match(/<button\\b/g) || []).length;',
      'process.exit(cap === cnt ? 0 : 1);',
    ].join('\n'));
    const strictVerify = 'node scripts/check-ratchet.cjs';
    write(dir, '.oxe/PLAN.json', JSON.stringify({
      schema_version: 1,
      tasks: [{ id: 'T2', title: 'b', wave: 1, files: ['src/b.tsx', 'tests/design-lint.test.ts'], done: true, verify: { commands: [strictVerify] } }],
    }, null, 2));
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
    git(dir, 'remote', 'add', 'origin', remote); git(dir, 'push', '-q', 'origin', 'main');

    // PR #2 (oxe/t2) removes 1 button in src/b.tsx and lowers cap 4 -> 3
    git(dir, 'checkout', '-qb', 'oxe/t2', 'main');
    write(dir, 'src/b.tsx', 'export const B = () => "<div><button>4</button></div>";\n');
    write(dir, 'tests/design-lint.test.ts', 'const RAW_BUTTON_CAP = 3;\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'feat: T2\n\nOXE-Task: F6/T2');
    git(dir, 'push', '-q', 'origin', 'oxe/t2');

    // Meanwhile on main, PR #1 merged: removed 2 buttons in src/a.tsx and lowered cap 4 -> 2 (conflicts on same line!)
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'src/a.tsx', 'export const A = () => "<div/>";\n');
    write(dir, 'tests/design-lint.test.ts', 'const RAW_BUTTON_CAP = 2;\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'PR #1 merged on main');
    git(dir, 'push', '-q', 'origin', 'main');

    op.appendEvent(dir, null, { type: 'TaskPromoted', work_item_id: 'T2', payload: { base: 'main', branch: 'oxe/t2', pr: 'https://github.com/o/r/pull/886' } });
    const spawn = (cmd, args, opts) => {
      if (cmd === 'gh') {
        if (args[1] === 'view') {
          return { status: 0, stdout: JSON.stringify({ state: 'OPEN', headRefName: 'oxe/t2', url: args[2], labels: [{ name: 'merge-train:removed' }], comments: [{ body: 'merge-train: removed (conflict with main)' }] }) };
        }
        return { status: 0, stdout: '' };
      }
      return spawnSync(cmd, args, opts);
    };

    const out = op.runtimeTrain(dir, null, { action: 'sync', apply: true, spawn });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].ok, true, JSON.stringify(out.results[0]));
    assert.deepEqual(out.results[0].steps.map((s) => s.step), ['reopen', 'merge origin/main', 'ratchet', 'verify', 'push (sem force)', 'relabel']);
    // Merged tree has 0 buttons in a.tsx + 1 button in b.tsx = 1!
    assert.equal(git(remote, 'show', 'oxe/t2:tests/design-lint.test.ts').stdout.trim(), 'const RAW_BUTTON_CAP = 1;');
  });
});
