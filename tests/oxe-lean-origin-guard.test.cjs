'use strict';

// lean bench v2 — "no origin, no stop": product code changed with no plan task, quick or CR keeps the session going once.
// A change request was implemented straight in the conversation twice in the bench; the second time the workflow had a
// rule against it that the agent never opened. The Stop hook does not depend on the agent reading anything.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('../bin/lib/oxe-origin-guard.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const HOOK = path.join(__dirname, '..', 'bin', 'lib', 'oxe-origin-guard.cjs');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1', NO_COLOR: '1' } });
const hook = (cwd, input) => spawnSync(process.execPath, [HOOK, '--project', cwd], { cwd, encoding: 'utf8', input: JSON.stringify(input || {}) });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function project({ program = true, plan = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-origin-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  write(dir, 'docs/BRIEF.md', '# brief\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/config.json', '{}');
  if (program) {
    const ph = (id, status) => ({ id, title: id, requirements: [], acceptance: ['A1'], scope: null, status, plan_ref: null, run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null });
    write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: plan ? 'F2' : null, created_at: 'x', updated_at: 'x', phases: [ph('F1', 'closed'), ph('F2', plan ? 'executing' : 'pending')] }));
  }
  if (plan) write(dir, '.oxe/PLAN.json', JSON.stringify(plan));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  return dir;
}

describe('lean v2: origin guard — product code needs an origin', () => {
  it('clean tree, docs-only and test-only changes pass', () => {
    const dir = project();
    assert.equal(guard.check(dir).ok, true);
    write(dir, 'docs/BRIEF.md', '# brief v2\n');
    write(dir, 'test/app.test.js', 'x\n');
    assert.equal(guard.check(dir).ok, true);
  });

  it('product code changed with a program and no origin is refused, naming the files and the two ways out', () => {
    const dir = project();
    write(dir, 'src/app.js', 'module.exports = 2;\n');
    write(dir, 'src/new.js', 'module.exports = 3;\n');
    const r = guard.check(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.stray.sort(), ['src/app.js', 'src/new.js']);
    assert.match(r.reason, /oxe-cc quick/);
    assert.match(r.reason, /runtime feedback --class new_scope/);
  });

  it('no program: nothing to guard', () => {
    const dir = project({ program: false });
    write(dir, 'src/app.js', 'module.exports = 2;\n');
    assert.equal(guard.check(dir).ok, true);
  });

  it('an open quick is an origin', () => {
    const dir = project();
    write(dir, 'src/app.js', 'module.exports = 2;\n');
    const opened = cli(dir, 'quick', 'CR-9', 'ajuste local do valor exportado', '--no-alm');
    assert.equal(opened.status, 0, opened.stdout + opened.stderr);
    assert.equal(guard.check(dir).ok, true);
    assert.equal(guard.check(dir).covered_by, 'quick aberto');
  });

  it('an open plan task that declares the file is an origin; a file outside it is not', () => {
    const dir = project({ plan: { schema_version: 1, phase: 'F2', tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/app.js'] }] } });
    write(dir, 'src/app.js', 'module.exports = 2;\n');
    assert.equal(guard.check(dir).ok, true);
    write(dir, 'src/other.js', 'module.exports = 9;\n');
    assert.deepEqual(guard.check(dir).stray, ['src/other.js']);
  });

  it('a folder that is not the top of its own repository is never judged', () => {
    const dir = project();
    write(dir, 'pkg/.oxe/program/PROGRAM.json', '{}');
    write(dir, 'pkg/src/x.js', 'x\n');
    assert.equal(guard.check(path.join(dir, 'pkg')).ok, true);
  });
});

describe('lean v2: origin guard as the Stop hook', () => {
  it('exit 2 with the reason on stderr; the continuation of a blocked stop passes and leaves a record', () => {
    const dir = project();
    write(dir, 'src/app.js', 'module.exports = 2;\n');
    const first = hook(dir, { hook_event_name: 'Stop', stop_hook_active: false });
    assert.equal(first.status, 2);
    assert.match(first.stderr, /guarda de origem.*src\/app\.js/);
    const second = hook(dir, { hook_event_name: 'Stop', stop_hook_active: true });
    assert.equal(second.status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'ORIGIN-VIOLATION.json'), 'utf8')).stray, ['src/app.js']);
  });

  it('a clean project and garbage on stdin both exit 0 (a guard that breaks never blocks)', () => {
    const dir = project();
    assert.equal(hook(dir, {}).status, 0);
    const r = spawnSync(process.execPath, [HOOK, '--project', dir], { cwd: dir, encoding: 'utf8', input: 'not json' });
    assert.equal(r.status, 0);
  });

  it('guards install --claude-guards writes the Stop hook; uninstall removes it; --no-origin-guard leaves it out', () => {
    const dir = project();
    assert.equal(cli(dir, 'guards', 'install', '--claude-guards', '--no-git-hooks', dir).status, 0);
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.match(JSON.stringify(read().hooks.Stop), /oxe-origin-guard\.cjs/);
    assert.equal(read().hooks.Stop.length, 1);
    cli(dir, 'guards', 'install', '--claude-guards', '--no-git-hooks', dir);
    assert.equal(read().hooks.Stop.length, 1, 'installing twice does not duplicate the hook');
    cli(dir, 'guards', 'uninstall', dir);
    assert.equal(read().hooks.Stop, undefined);
    cli(dir, 'guards', 'install', '--claude-guards', '--no-git-hooks', '--no-origin-guard', dir);
    assert.equal(read().hooks.Stop, undefined);
  });
});
