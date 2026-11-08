'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { dryRunVerifyCommands, treeHash } = require('../bin/lib/oxe-verify-dryrun.cjs');

// 1.21.2 — OXB-084: an 18-task plan (~220 verify commands) ran silent for 30+ min under `plan lint --dry-verify`, was
// killed twice by the host's memory reaper, and each restart began from zero.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dr-'));
  dirs.push(dir);
  const g = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.oxe/\n');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'x\n');
  // Each run appends a line to runs.log (gitignored, so it does not change the tree): the count of real executions.
  fs.writeFileSync(path.join(dir, 'missing.js'), "require('fs').appendFileSync('.oxe/runs.log', process.argv[2] + '\\n'); console.error(\"Error: Cannot find module './src/\" + process.argv[2] + \".js'\"); process.exit(1);\n");
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  g('add', '-A');
  g('commit', '-qm', 'base');
  return dir;
}
const runs = (dir) => (fs.existsSync(path.join(dir, '.oxe', 'runs.log')) ? fs.readFileSync(path.join(dir, '.oxe', 'runs.log'), 'utf8').trim().split('\n').filter(Boolean) : []);
const plan = { tasks: [
  { id: 'T1', files: ['src/a.js', 'src/a2.js'], verifyCommand: 'node missing.js a && node missing.js a2' },
  { id: 'T2', files: ['src/b.js'], verifyCommand: 'node missing.js b' },
  { id: 'T3', files: ['src/c.js'], verifyCommand: 'node missing.js c' },
] };

describe('OXB-084: plan lint --dry-verify progress, resume and subsets', () => {
  it('one progress line per command, numbered [n/N], with the task, the command and the verdict', () => {
    const dir = repo();
    const lines = [];
    dryRunVerifyCommands(dir, plan, { onProgress: (l) => lines.push(l), cachePath: path.join(dir, '.oxe', 'cache', 'dry-verify.json') });
    assert.match(lines[0], /^dry-verify: 4 comando\(s\) em 3 tarefa\(s\)/);
    const done = lines.filter((l) => / ok \d+s$/.test(l));
    assert.equal(done.length, 4, lines.join('\n'));
    assert.match(done[0], /^\[1\/4\] T1 node missing\.js a \.\.\. ok \d+s$/);
    assert.match(done[3], /^\[4\/4\] T3 node missing\.js c/);
  });

  it('--resume skips the commands already run on the same tree; a changed tree reruns them', () => {
    const dir = repo();
    const cachePath = path.join(dir, '.oxe', 'cache', 'dry-verify.json');
    // An interrupted run: only T1 got through.
    dryRunVerifyCommands(dir, { tasks: [plan.tasks[0]] }, { cachePath });
    assert.equal(runs(dir).length, 2);
    const lines = [];
    const r = dryRunVerifyCommands(dir, plan, { cachePath, resume: true, onProgress: (l) => lines.push(l) });
    assert.equal(r.reused, 2);
    assert.deepEqual(runs(dir), ['a', 'a2', 'b', 'c'], 'T1 not run again');
    assert.ok(lines.some((l) => /T1 .*já rodado nesta árvore/.test(l)));
    assert.deepEqual(r.results.map((x) => x.verdict), ['missing_target', 'missing_target', 'missing_target']);
    // Edit a tracked file: a different tree, nothing reused.
    const before = treeHash(dir);
    fs.writeFileSync(path.join(dir, 'base.txt'), 'y\n');
    assert.notEqual(treeHash(dir), before);
    const again = dryRunVerifyCommands(dir, plan, { cachePath, resume: true });
    assert.equal(again.reused, 0);
    assert.equal(runs(dir).length, 8);
  });

  it('--only runs the named tasks; --changed runs only tasks whose verify or files changed', () => {
    const dir = repo();
    const cachePath = path.join(dir, '.oxe', 'cache', 'dry-verify.json');
    const only = dryRunVerifyCommands(dir, plan, { cachePath, only: ['t2'] });
    assert.deepEqual(only.results.map((x) => x.task), ['T2']);
    assert.ok(only.warnings.some((w) => /parcial: 2 tarefa\(s\) fora desta rodada \(T1, T3\)/.test(w)));
    dryRunVerifyCommands(dir, plan, { cachePath });
    const edited = { tasks: plan.tasks.map((t) => (t.id === 'T3' ? { ...t, verifyCommand: 'node missing.js c3' } : t)) };
    const changed = dryRunVerifyCommands(dir, edited, { cachePath, changed: true });
    assert.deepEqual(changed.results.map((x) => x.task), ['T3']);
  });

  it('the CLI prints progress on stderr, keeps --json on stdout parseable, and --only implies --dry-verify', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | b |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node missing.js a'] } },
      { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], acceptance: ['A1'], verify: { commands: ['node missing.js b'] } },
    ] }));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'oxe-cc.js'), 'plan', 'lint', '--only', 'T2', '--dry-verify-anyway', '--no-preflight', '--json', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.dry_verify.map((x) => x.task), ['T2']);
    assert.match(r.stderr, /\[1\/1\] T2 node missing\.js b \.\.\. ok \d+s/);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'cache', 'dry-verify.json')));
  });
});

describe('OXB-089: structural checks before the dry-verify', () => {
  it('with structural errors the dry-verify does not run (says so); --dry-verify-anyway runs it', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | b |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ external_dependency_check: false }));
    // Two tasks of one wave writing the same file: structural.
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node missing.js a'] } },
      { id: 'T2', title: 'b', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node missing.js b'] } },
    ] }));
    const lines = [];
    const op = require('../bin/lib/oxe-operational.cjs');
    const skipped = op.runtimePlanLint(dir, null, { preflight: false, dryVerify: true, onProgress: (l) => lines.push(l) });
    assert.ok(skipped.errors.some((e) => /T1 e T2 escrevem src\/a\.js/.test(e)));
    assert.match(skipped.dry_verify_skipped, /erro\(s\) estrutura\(is\); dry-verify não rodou/);
    assert.equal(skipped.dry_verify, null);
    assert.deepEqual(runs(dir), [], 'no verify command ran');
    assert.match(lines.join('\n'), /dry-verify: não rodou/);
    const anyway = op.runtimePlanLint(dir, null, { preflight: false, dryVerify: true, dryVerifyAnyway: true });
    assert.equal(anyway.dry_verify.length, 2);
  });
});
