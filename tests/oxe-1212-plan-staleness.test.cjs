'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');

// 1.21.2 — OXB-126: detect a stale plan before the execute; plan refresh; a sketch phase does not execute.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ps-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Depois\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [
    { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
    { id: 'T3', title: 'c', wave: 1, files: ['src/c.js', 'src/gone.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } },
  ] }, null, 2));
  for (const f of ['a', 'c', 'gone']) write(dir, `src/${f}.js`, '1\n');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  return dir;
}
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, 'plan', ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });

describe('OXB-126: plan staleness', () => {
  it('a merge touching T3\'s scope after the plan: the execute refuses naming T3; the plan\'s own checkpoints do not count', () => {
    const dir = project();
    assert.equal(cli(dir, 'staleness', '--stamp').status, 0);
    // the plan's own checkpoint (T1) and a foreign change (another PR) on T3's files
    write(dir, 'src/a.js', '2\n'); git(dir, 'commit', '-qam', 'feat: T1', '-m', 'OXE-Task: T1');
    write(dir, 'src/c.js', 'merged from main\n'); fs.rmSync(path.join(dir, 'src', 'gone.js')); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'Merge PR #900');
    const r = cli(dir, 'staleness');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /T3: src\/c\.js o arquivo mudou depois do plano/);
    assert.match(r.stdout, /T3: src\/gone\.js o caminho foi removido depois do plano/);
    assert.doesNotMatch(r.stdout, /T1:/);
    const pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre.blockers.some((b) => /^plan_stale:T3/.test(b)), pre.blockers.join('\n'));
  });

  it('plan refresh --tasks T3 records the review; the execute no longer refuses; ids and other tasks preserved', () => {
    const dir = project();
    cli(dir, 'staleness', '--stamp');
    write(dir, 'src/c.js', 'merged\n'); git(dir, 'commit', '-qam', 'merge');
    assert.equal(cli(dir, 'refresh', '--tasks', 'T3').status, 0);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    assert.deepEqual(doc.tasks.map((t) => t.id), ['T1', 'T3']);
    assert.ok(doc.tasks[1].base_sha && !doc.tasks[0].base_sha);
    assert.equal(cli(dir, 'staleness').status, 0);
  });

  it('a phase in sketch is not executed', () => {
    const dir = project();
    op.runtimeProgramInit(dir, null, {});
    const pdir = path.join(dir, '.oxe', 'program');
    const s = programLib.readProgram(pdir);
    s.phases[0].detail = 'sketch';
    programLib.writeProgram(pdir, s);
    op.runtimeProgramStart(dir, null, 'F1');
    const pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre.blockers.some((b) => /^phase_sketch:F1/.test(b)));
  });
});
