'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const runtime = require('../lib/runtime/index.js');

// 1.21.2 — OXB-050: the mutating tasks of a wave ran one by one even with disjoint scopes (T8 Threads/*, T9 OxeQuery/*).
// Everything is local: a fake executor, git worktrees, a node_modules junction. No paid run.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const verifyHas = (file, text) => `node -e "process.exit(require('fs').readFileSync('${file}','utf8').includes('${text}')?0:1)"`;
const verifyDep = `node -e "require('fake-dep')"`;

function project({ plan, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-par-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Objetivo\n\nx\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | manual |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false, deps_strategy: 'link', deps_link_from: '.', parallel: { max: 2 }, ...config }));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\nnode_modules/\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'fake-dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'fake-dep', 'package.json'), '{"name":"fake-dep","version":"1.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(dir, 'node_modules', 'fake-dep', 'index.js'), 'module.exports = 1;\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'base.js'), 'module.exports = 0;\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

/** Writes `files[task]` into the lease, slowly, and records how many tasks were running at once. */
function trackingExecutor(files, extra = {}) {
  const stats = { active: 0, max: 0, running: new Set(), overlaps: [] };
  return {
    stats,
    async execute(node, lease) {
      stats.active += 1;
      stats.max = Math.max(stats.max, stats.active);
      for (const other of stats.running) stats.overlaps.push([other, node.id].sort().join('+'));
      stats.running.add(node.id);
      await new Promise((r) => setTimeout(r, 400));
      for (const [rel, content] of Object.entries({ ...(files[node.id] || {}), ...(extra[node.id] || {}) })) {
        fs.mkdirSync(path.dirname(path.join(lease.root_path, rel)), { recursive: true });
        fs.writeFileSync(path.join(lease.root_path, rel), content);
      }
      stats.running.delete(node.id);
      stats.active -= 1;
      return { success: true, failure_class: null, evidence: Object.keys(files[node.id] || {}), output: 'ok', completed_by: 'finish_task' };
    },
  };
}

const PLAN = {
  schema_version: 1,
  tasks: [
    { id: 'T1', title: 'threads', wave: 1, files: ['src/threads/a.js'], verify: { commands: [verifyHas('src/threads/a.js', 'threads'), verifyDep] } },
    { id: 'T2', title: 'oxequery', wave: 1, files: ['src/query/b.js'], verify: { commands: [verifyHas('src/query/b.js', 'query'), verifyDep] } },
    { id: 'T3', title: 'threads again', wave: 1, files: ['src/threads/c.js', 'src/threads'], verify: { commands: [verifyHas('src/threads/c.js', 'more')] } },
  ],
};
const FILES = {
  T1: { 'src/threads/a.js': 'module.exports = "threads";\n' },
  T2: { 'src/query/b.js': 'module.exports = "query";\n' },
  T3: { 'src/threads/c.js': 'module.exports = "more";\n' },
};

describe('OXB-050: --parallel-mutating', () => {
  it('disjoint scopes run at once (max 2), an overlapping scope never does; each task is integrated and committed; main node_modules survives', async () => {
    const dir = project({ plan: PLAN });
    const executor = trackingExecutor(FILES, { T2: { 'src/outside.js': 'nope\n' } });
    const events = [];
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, checkpointCommits: true, parallelMutating: true, onProgress: (e) => events.push(e) });
    assert.deepEqual([...res.result.completed].sort(), ['T1', 'T2', 'T3'], JSON.stringify(res.result));
    assert.equal(executor.stats.max, 2, 'two agents at once');
    assert.ok(!executor.stats.overlaps.includes('T1+T3'), `T1 and T3 share src/threads: ${executor.stats.overlaps}`);
    assert.ok(executor.stats.overlaps.includes('T1+T2') || executor.stats.overlaps.includes('T2+T3'));
    for (const [rel, text] of [['src/threads/a.js', 'threads'], ['src/query/b.js', 'query'], ['src/threads/c.js', 'more']]) {
      assert.match(fs.readFileSync(path.join(dir, rel), 'utf8'), new RegExp(text));
    }
    const log = git(dir, 'log', '--format=%B').stdout;
    for (const id of ['T1', 'T2', 'T3']) assert.match(log, new RegExp(`OXE-Task: ${id}`));
    assert.equal(fs.existsSync(path.join(dir, 'src', 'outside.js')), false, 'an edit outside the scope is never integrated');
    assert.ok(events.some((e) => e.type === 'ScopeViolation' && e.payload && e.payload.outcome === 'not_integrated' && e.payload.paths.includes('src/outside.js')));
    assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'fake-dep', 'index.js')), 'the linked node_modules was never deleted by a dispose');
    const left = fs.existsSync(path.join(dir, '.oxe', 'workspaces')) ? fs.readdirSync(path.join(dir, '.oxe', 'workspaces')) : [];
    assert.deepEqual(left, [], 'every worktree disposed');
  });

  it('green in the worktree but red on the integrated tree: the integration is undone and the task does not complete', async () => {
    const plan = { schema_version: 1, tasks: [
      // The verify needs a helper the task wrote OUTSIDE its scope: it passes in the worktree, never in the checkout.
      { id: 'T1', title: 'needs helper', wave: 1, files: ['src/a.js'], verify: { commands: [`node -e "require('./src/helper.js')"`] } },
      { id: 'T2', title: 'other', wave: 1, files: ['src/b.js'], verify: { commands: [verifyHas('src/b.js', 'b')] } },
    ] };
    const dir = project({ plan });
    const executor = trackingExecutor({ T1: { 'src/a.js': 'a\n', 'src/helper.js': 'module.exports = 1;\n' }, T2: { 'src/b.js': 'b\n' } });
    const res = await op.runRuntimeExecute(dir, null, { executor, skipPreflight: true, checkpointCommits: true, parallelMutating: true, maxRetries: 0 });
    assert.ok(res.result.failed.includes('T1'), JSON.stringify(res.result));
    assert.ok(res.result.completed.includes('T2'));
    assert.equal(fs.existsSync(path.join(dir, 'src', 'a.js')), false, 'the failed integration was discarded');
  });

  it('refused before any paid turn: no checkpoint commits, a dirty tree, link mode with a dependency change, a protected link source', async () => {
    const call = (dir, opts = {}) => op.runRuntimeExecute(dir, null, { executor: trackingExecutor(FILES), skipPreflight: true, checkpointCommits: true, parallelMutating: true, ...opts });
    await assert.rejects(call(project({ plan: PLAN }), { checkpointCommits: false }), /exige --checkpoint-commits/);
    const dirty = project({ plan: PLAN });
    fs.writeFileSync(path.join(dirty, 'src', 'base.js'), 'changed\n');
    await assert.rejects(call(dirty), /working tree com mudanças fora de \.oxe/);
    const deps = project({ plan: { schema_version: 1, tasks: [...PLAN.tasks, { id: 'T4', title: 'bump', wave: 1, files: ['package.json'], verify: { commands: ['node -e "0"'] } }] } });
    await assert.rejects(call(deps), /T4: muda package\.json\/lockfile — no deps_strategy link o node_modules é compartilhado; use deps_strategy copy-from ou ci/);
    const installs = project({ plan: { schema_version: 1, tasks: [{ id: 'T5', title: 'x', wave: 1, files: ['src/x.js'], verify: { commands: ['npm ci && node -e "0"'] } }] } });
    await assert.rejects(call(installs), /T5: instala dependências no verify/);
    const prot = project({ plan: PLAN, config: { deps_protected: ['.'] } });
    await assert.rejects(call(prot), /é um caminho protegido/);
    const none = project({ plan: PLAN, config: { deps_strategy: null } });
    await assert.rejects(call(none), /configure "deps_strategy"/);
    const noFrom = project({ plan: PLAN, config: { deps_link_from: null } });
    await assert.rejects(call(noFrom), /exige "deps_link_from" explícito/);
  });

  it('a stale lease left by a crash: its junction is removed BEFORE the worktree, so the real node_modules survives', () => {
    const dir = project({ plan: PLAN });
    const ws = path.join(dir, '.oxe', 'workspaces', 'ws-T9-a1-dead');
    assert.equal(git(dir, 'worktree', 'add', ws, '-b', 'oxe/dead').status, 0);
    fs.symlinkSync(path.join(dir, 'node_modules'), path.join(ws, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const removed = runtime.sweepStaleWorkspaces(dir);
    assert.equal(removed.length, 1);
    assert.equal(fs.existsSync(ws), false);
    assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'fake-dep', 'index.js')), 'node_modules intact');
  });

  it('scopesOverlap: same file, a directory and its file, globs; disjoint dirs do not overlap', () => {
    assert.equal(runtime.scopesOverlap(['src/threads/a.js'], ['src/query/b.js']), false);
    assert.equal(runtime.scopesOverlap(['src/threads'], ['src/threads/a.js']), true);
    assert.equal(runtime.scopesOverlap(['src/threads/**'], ['src/threads/a.js']), true);
    assert.equal(runtime.scopesOverlap(['src/a/*.ts'], ['src/b/x.ts']), false);
    assert.equal(runtime.scopesOverlap([], ['src/a.js']), true, 'an empty scope may touch anything');
  });
});
