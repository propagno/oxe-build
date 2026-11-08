'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');
const changeLib = require('../bin/lib/oxe-change.cjs');
const scratch = require('../bin/lib/oxe-scratch.cjs');
const { validatePlanJson } = require('../bin/lib/oxe-plan-json.cjs');
const { buildNodePrompt } = require('../lib/runtime/executor/node-prompt-builder');

// 1.21.2 — OXB-159: (1) `runtime feedback` in a forked worktree (F4) registered CR-35 while the program tree already
// had CR-35 (F7); (2) F4-T1's attempts left a13-out.log / tsconfig.tsbuildinfo in the repo root → ScopeViolation.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

const ROADMAP = '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n\n## Fase 2 — Outra\n\n**Depende de:** F1\n**Critérios de aceite:** A2\n\n## Fase 3 — Paralela\n\n**Depende de:** F1\n**Critérios de aceite:** A3\n';
function project() {
  const dir = tmp('oxe-1212-crid-');
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | a | m |\n| A2 | b | m |\n| A3 | c | m |\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'ROADMAP.md'), ROADMAP);
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  op.runtimeProgramInit(dir, null, {});
  return dir;
}
const pdir = (dir) => path.join(dir, '.oxe', 'program');
const read = (dir) => programLib.readProgram(pdir(dir));
const closeHere = (dir, id, extra = {}) => {
  const s = read(dir);
  Object.assign(s.phases.find((x) => x.id === id), { status: 'closed', closed_at: new Date().toISOString(), closed_commit: 'abc' });
  if (s.active_phase === id) s.active_phase = null;
  programLib.writeProgram(pdir(dir), s);
  fs.mkdirSync(path.join(pdir(dir), 'regression'), { recursive: true });
  fs.writeFileSync(path.join(pdir(dir), 'regression', `${id}.json`), JSON.stringify({ schema_version: 1, phase: id, checks: [{ id: `chk-${id}`, command: 'node -e 0', resolves: extra.resolves || [] }] }));
};
const record = (dir, phase, summary) => changeLib.recordChange({ programDir: pdir(dir), program: read(dir), plan: null, class: 'defect', summary, criteria: 'A1', phase }).cr;

describe('OXB-159: CR ids across worktrees', () => {
  it('nextId: plain CR-NN over plain ids only; with a phase prefix, CR-<fase>-n', () => {
    const ids = [{ id: 'CR-09' }, { id: 'CR-F4-3' }, { id: 'CR-35' }];
    assert.equal(changeLib.nextId(ids), 'CR-36', 'CR-F4-3 is not read as 43');
    assert.equal(changeLib.nextId(ids, 'F4'), 'CR-F4-4');
    assert.equal(changeLib.nextId(ids, 'F7'), 'CR-F7-1');
  });

  it('a forked worktree (program init --from) numbers its CRs by phase; the program tree keeps CR-NN', () => {
    const main = project();
    closeHere(main, 'F1');
    record(main, 'F1', 'defeito antigo na base');
    const fork = tmp('oxe-1212-crid-fork-');
    spawnSync('git', ['init', '-q'], { cwd: fork });
    op.runtimeProgramInitFrom(fork, null, { from: main, phase: 'F3' });
    assert.equal(record(fork, 'F3', 'defeito achado na worktree').id, 'CR-F3-1');
    assert.equal(record(main, 'F2', 'defeito achado no tronco').id, 'CR-02');
  });

  it('adopt brings the fork CRs; a colliding id (the rc.23 case) is renamed CR-<fase>-n, statuses and resolves follow', () => {
    const main = project();
    closeHere(main, 'F1');
    const fork = tmp('oxe-1212-crid-fork-');
    spawnSync('git', ['init', '-q'], { cwd: fork });
    op.runtimeProgramInitFrom(fork, null, { from: main, phase: 'F3' });
    // the old numbering in the fork: CR-01 for F3 — while the program tree registered its own CR-01 (F2)
    changeLib.appendNdjson(changeLib.changesFile(pdir(fork)), { kind: 'cr', id: 'CR-01', class: 'defect', summary: 'defeito da F3 na worktree', criteria: ['A3'], phase: 'F3', at: '2026-11-08T10:00:00.000Z', status: 'open' });
    changeLib.setChangeStatus(pdir(fork), 'CR-01', 'resolved', { resolution: 'teste verde', by: 'verify' });
    record(main, 'F2', 'defeito da F2 no tronco');
    closeHere(fork, 'F3', { resolves: ['CR-01'] });
    fs.mkdirSync(path.join(fork, '.oxe', 'dossier', 'F3'), { recursive: true });
    fs.writeFileSync(path.join(fork, '.oxe', 'dossier', 'F3', 'DOSSIER.md'), '# F3\n\nCR-01 resolvido.\n');

    const r = spawnSync(process.execPath, [CLI, 'runtime', 'program', 'adopt', '--from', fork, '--phase', 'F3', '--by', 'tl', '--reason', 'F3 fechada na worktree', '--dir', main], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /CR-01 -> CR-F3-1/);
    const crs = changeLib.listChanges(pdir(main));
    const mine = crs.find((c) => c.id === 'CR-01');
    const theirs = crs.find((c) => c.id === 'CR-F3-1');
    assert.equal(mine.phase, 'F2');
    assert.equal(mine.status, 'open', "the fork's resolution does not close the program tree's CR-01");
    assert.equal(theirs.phase, 'F3');
    assert.equal(theirs.origin_id, 'CR-01');
    assert.equal(theirs.status, 'resolved');
    const reg = JSON.parse(fs.readFileSync(path.join(pdir(main), 'regression', 'F3.json'), 'utf8'));
    assert.deepEqual(reg.checks[0].resolves, ['CR-F3-1']);
    assert.match(fs.readFileSync(path.join(main, '.oxe', 'dossier', 'F3', 'DOSSIER.md'), 'utf8'), /CR-F3-1 resolvido/);
  });

  it('merging twice adds nothing; records copied at the fork are not duplicated', () => {
    const main = project();
    closeHere(main, 'F1');
    record(main, 'F1', 'defeito antigo na base');
    const fork = tmp('oxe-1212-crid-fork-');
    spawnSync('git', ['init', '-q'], { cwd: fork });
    op.runtimeProgramInitFrom(fork, null, { from: main, phase: 'F3' });
    record(fork, 'F3', 'defeito novo na worktree');
    const first = changeLib.mergeChanges(pdir(main), pdir(fork), { phase: 'F3', from: 'fork' });
    assert.equal(first.merged, 1);
    assert.deepEqual(first.renamed, {});
    const second = changeLib.mergeChanges(pdir(main), pdir(fork), { phase: 'F3', from: 'fork' });
    assert.equal(second.merged, 0);
    assert.deepEqual(changeLib.listChanges(pdir(main)).map((c) => c.id).sort(), ['CR-01', 'CR-F3-1']);
  });

  it('resolves and feedback resolve accept CR-<fase>-n', () => {
    const doc = { schema_version: 1, tasks: [{ id: 'T1', title: 't', files: ['a.js'], verify: { command: 'node -e 0' } }], acceptance_tests: [{ id: 'acc-1', criterion: 'A1', files: ['t.test.js'], resolves: ['CR-F4-1', 'CR-12'] }] };
    const v = validatePlanJson(doc);
    const errs = Array.isArray(v) ? v : v.errors;
    assert.ok(!errs.some((e) => /resolves/.test(e)), errs.join('; '));
    const bad = validatePlanJson({ ...doc, acceptance_tests: [{ ...doc.acceptance_tests[0], resolves: ['CR-x'] }] });
    assert.ok((Array.isArray(bad) ? bad : bad.errors).some((e) => /resolves/.test(e)));
    const main = project();
    const fork = tmp('oxe-1212-crid-fork-');
    spawnSync('git', ['init', '-q'], { cwd: fork });
    closeHere(main, 'F1');
    op.runtimeProgramInitFrom(fork, null, { from: main, phase: 'F3' });
    record(fork, 'F3', 'defeito novo na worktree');
    const out = op.runtimeChangeSetStatus(fork, null, { id: 'cr-f3-1', status: 'withdrawn', by: 'tl', reason: 'escopo retirado da fase' });
    assert.equal(out.id, 'CR-F3-1');
  });
});

describe('OXB-159: executor scratch', () => {
  it('a glob without / matches the repo root only', () => {
    const is = scratch.makeScratchMatcher(tmp('oxe-1212-scr-'));
    assert.ok(is('a13-out.log'));
    assert.ok(is('tsconfig.tsbuildinfo'));
    assert.ok(!is('src/app.log'), 'a log under src/ is real work (or a real violation)');
    assert.ok(!is('src/index.ts'));
  });

  it('executor.scratch_ignore extends the defaults; false turns it off', () => {
    const dir = tmp('oxe-1212-scr-');
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ executor: { scratch_ignore: ['tmp/**', '*.out'] } }));
    const is = scratch.makeScratchMatcher(dir);
    assert.ok(is('tmp/a/b.txt') && is('run.out') && is('x.log'));
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ executor: { scratch_ignore: false } }));
    assert.ok(!scratch.makeScratchMatcher(dir)('x.log'));
  });

  it('splitScratch: root scratch is not a violation; new untracked scratch is removed, tracked or pre-existing is kept', () => {
    const dir = tmp('oxe-1212-scr-');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'tracked.log'), 'v1\n');
    spawnSync('git', ['add', '.'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'before.log'), 'dirty before the task\n');
    const baseline = op.treeSnapshot ? op.treeSnapshot(dir) : new Map([['before.log', 'h']]);
    fs.writeFileSync(path.join(dir, 'a13-out.log'), 'x\n');
    fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');
    fs.writeFileSync(path.join(dir, 'tracked.log'), 'v2\n');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'other.ts'), 'x');
    const is = scratch.makeScratchMatcher(dir);
    const r = scratch.splitScratch(dir, ['a13-out.log', 'before.log', 'src/other.ts', 'tracked.log', 'tsconfig.tsbuildinfo'], baseline, is);
    assert.deepEqual(r.outside, ['src/other.ts']);
    assert.deepEqual(r.removed.sort(), ['a13-out.log', 'tsconfig.tsbuildinfo']);
    assert.ok(fs.existsSync(path.join(dir, 'before.log')), 'dirty before the task: kept');
    assert.ok(fs.existsSync(path.join(dir, 'tracked.log')), 'tracked: kept');
  });

  it('ensureScratchDir creates .oxe/tmp/<task> ignored by git', () => {
    const dir = tmp('oxe-1212-scr-');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const d = scratch.ensureScratchDir(dir, 'F4-T1');
    fs.writeFileSync(path.join(d, 'out.log'), 'x');
    const st = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, encoding: 'utf8' });
    assert.equal(st.stdout.trim(), '', st.stdout);
    scratch.removeScratchDir(dir, 'F4-T1');
    assert.ok(!fs.existsSync(d));
  });

  it('the prompt of a mutating task names its scratch dir', () => {
    const node = { id: 'F4-T1', title: 'Mexer', mutation_scope: ['src/a.ts'], actions: [], verify: { must_pass: [], command: null }, depends_on: [], workspace_strategy: 'inplace', policy: {} };
    const prompt = buildNodePrompt(node, { root_path: '/w', workspace_id: 'w', strategy: 'inplace' }, 'run-1', 1);
    assert.match(prompt, /\.oxe\/tmp\/F4-T1\//);
  });
});
