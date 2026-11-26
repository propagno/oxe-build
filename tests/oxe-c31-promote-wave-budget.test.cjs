'use strict';

// OXB-C31 (8e 22/11, 152perf on af7e602): promote dropped the planner's amendment of a non-frozen test (C31-2);
// C31-1 (stacked PR carrying the parent) was retracted: stacking on an open depends_on parent is by design (OXB-161); `runtime execute --mode wave` was ignored (C31-3); `--budget-add-usd` (C31-4).

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const budget = require('../bin/lib/oxe-budget.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1', OXE_NO_VERSION_WARN: '1' } });
const fakeGh = () => {
  let n = 1040;
  return (cmd, args) => {
    if (args[0] === 'pr' && args[1] === 'create') { n += 10; return { status: 0, stdout: `https://github.com/x/y/pull/${n}\n`, stderr: '' }; }
    if (args[0] === 'pr' && args[1] === 'view') return { status: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
};

function repo(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c31-'));
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  fs.mkdirSync(dir);
  git(root, 'init', '-q', '--bare', origin);
  const g = (...a) => git(dir, ...a);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'src/index.js', 'module.exports = 0;\n');
  write(dir, 'tests/state.test.js', 'old assertion\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  g('checkout', '-qb', 'oxe/program');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  build(dir, g);
  return dir;
}

describe('OXB-C31-2: the planner amendment of a non-frozen test goes with the task', () => {
  it('OXE-Plan commit with the task\'s frozen test + tests/state.test.js → the PR carries the amended state test', () => {
    const dir = repo((d, g) => {
      write(d, 'tests/acc/t2.test.js', 'frozen T2\n');
      write(d, 'tests/state.test.js', 'new assertion (hooks first)\n');
      g('add', '-A'); g('commit', '-qm', 'test(acceptance): frozen tests of T2', '-m', 'OXE-Plan: perf/F1');
      write(d, 'src/agent-state.js', 'module.exports = "hooks first";\n');
      g('add', '-A'); g('commit', '-qm', 'feat: T2 hooks first', '-m', 'OXE-Task: T2');
      write(d, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1,
        tasks: [{ id: 'T2', title: 'hooks first', wave: 1, files: ['src/agent-state.js'], acceptance: ['A2'], done: true }],
        acceptance_tests: [{ criterion: 'A2', task: 'T2', files: ['tests/acc/t2.test.js'] }] }));
    });
    const t2 = op.runtimePromote(dir, null, { task: 'T2', base: 'main', openPr: true, ghSpawn: fakeGh() });
    assert.equal(t2.error, undefined, t2.error);
    assert.equal(git(dir, 'show', 'origin/oxe/promote-t2:tests/state.test.js'), 'new assertion (hooks first)');
    assert.equal(git(dir, 'show', 'origin/oxe/promote-t2:tests/acc/t2.test.js'), 'frozen T2');
    assert.match(t2.warnings.join('\n'), /tests\/state\.test\.js: emenda do planejador.*OXB-C31-2/);
  });
  it('a planner commit that also freezes another task\'s tests: the amendment is named, not carried', () => {
    const dir = repo((d, g) => {
      write(d, 'tests/acc/t2.test.js', 'frozen T2\n');
      write(d, 'tests/acc/t4.test.js', 'frozen T4\n');
      write(d, 'tests/state.test.js', 'new assertion\n');
      g('add', '-A'); g('commit', '-qm', 'test(acceptance): frozen tests', '-m', 'OXE-Plan: perf/F1');
      write(d, 'src/agent-state.js', 'x\n');
      g('add', '-A'); g('commit', '-qm', 'feat: T2', '-m', 'OXE-Task: T2');
      write(d, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1,
        tasks: [{ id: 'T2', title: 'a', wave: 1, files: ['src/agent-state.js'], acceptance: ['A2'], done: true }, { id: 'T4', title: 'b', wave: 1, files: ['src/b.js'], acceptance: ['A4'] }],
        acceptance_tests: [{ criterion: 'A2', task: 'T2', files: ['tests/acc/t2.test.js'] }, { criterion: 'A4', task: 'T4', files: ['tests/acc/t4.test.js'] }] }));
    });
    const t2 = op.runtimePromote(dir, null, { task: 'T2', base: 'main', dryRun: true });
    assert.match(t2.warnings.join('\n'), /emenda do planejador em tests\/state\.test\.js .*fica de fora.*T4/);
  });
});

describe('OXB-C31-3: runtime execute --mode', () => {
  const plan = () => repo((d) => {
    write(d, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], done: true },
      { id: 'T5', title: 'b', wave: 2, files: ['src/b.js'] },
      { id: 'T7', title: 'c', wave: 3, files: ['src/c.js'] },
    ] }));
  });
  it('--mode wave = the first wave with a pending task', () => {
    const r = cli(plan(), 'runtime', 'execute', '--mode', 'wave', '--dry-run');
    assert.match(r.stdout, /--mode wave (?:→|->) --wave 2/);
  });
  it('an unknown --mode is an error, never a silent full run', () => {
    const r = cli(plan(), 'runtime', 'execute', '--mode', 'onda');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /use --mode wave .* ou --mode full/);
  });
});

describe('OXB-C31-4: --budget-add-usd', () => {
  it('the cap becomes what was spent + X', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c31b-'));
    dirs.push(dir);
    const l = budget.openBudget(dir, 'run-1', { usd: 48 });
    budget.recordUsage(dir, l, { task: 'T5', attempt: 1, turns: 3, cost_usd: 47.5 });
    const next = budget.openBudget(dir, 'run-1', { usdAdd: 10, turnsAdd: 5 });
    assert.equal(next.limit_usd, 57.5);
    assert.equal(next.limit_turns, 8);
    assert.match(budget.exhaustedReason({ ...next, used_usd: 58 }) || '', /--budget-add-usd/);
  });
  it('--budget-usd with --budget-add-usd is refused', () => {
    const r = cli(fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c31c-')), 'runtime', 'execute', '--budget-usd', '50', '--budget-add-usd', '10');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não os dois/);
  });
});

describe('OXB-C31-5: quick promote checks origin against <remote>/<base>', () => {
  it('a local main behind origin/main: the range is origin/main..HEAD, with a warning', async () => {
    const quick = require('../bin/lib/oxe-quick.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c315-'));
    dirs.push(root);
    const origin = path.join(root, 'origin.git');
    const dir = path.join(root, 'work');
    fs.mkdirSync(dir);
    git(root, 'init', '-q', '--bare', origin);
    const g = (...a) => git(dir, ...a);
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
    write(dir, '.gitignore', '.oxe/\n');
    write(dir, 'a.txt', '0\n');
    g('add', '-A'); g('commit', '-qm', 'base');
    g('remote', 'add', 'origin', origin);
    // main moves on origin (merged PRs, no OXE trailers) while the local main stays behind
    for (const n of [1, 2, 3]) { write(dir, 'a.txt', `${n}\n`); g('commit', '-qam', `merged PR ${n}`); }
    g('push', '-q', 'origin', 'main');
    g('reset', '-q', '--hard', 'HEAD~3');
    g('fetch', '-q', 'origin');
    g('checkout', '-qb', 'fix/oxe-386', 'origin/main');
    const started = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-386', objective: 'quick sobre a main remota', noAlm: true });
    write(dir, 'fix.txt', 'ok\n');
    quick.commit(dir, { message: 'fix: oxe-386', paths: ['fix.txt'] });
    await op.runtimeQuick(dir, null, { action: 'done', noAlm: true });
    const out = await op.runtimeQuick(dir, null, { action: 'promote', id: started.id, base: 'main', dryRun: true });
    assert.equal(out.range_base, 'origin/main');
    assert.match((out.warnings || []).join('\n'), /main está 3 commit\(s\) atrás de origin\/main/);
    assert.equal(out.origin.range, 'origin/main..HEAD');
    assert.notEqual(out.origin.ok, false, JSON.stringify(out.origin.violations || []));
  });
});
