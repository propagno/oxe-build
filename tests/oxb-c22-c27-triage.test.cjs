'use strict';

// OXB-C24-2, C25, C26 (8e, 21/11): the pack's ready flag, a symbol signature by CLI, and runtime execute --dry-run.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planBuild = require('../bin/lib/oxe-plan-build.cjs');
const rationality = require('../bin/lib/oxe-rationality.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function git(dir, ...args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); }
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxb-c25-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@oxe.dev');
  git(dir, 'config', 'user.name', 'T');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}
const packFile = (dir) => path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json');
const writePack = (dir, pack) => fs.writeFileSync(packFile(dir), JSON.stringify(pack, null, 2));
function builtPack(dir) {
  const res = planBuild.build([{ file: 'role.json', doc: { role: 'x', tasks: [{ rid: 'R1', title: 'doc', files: ['README.md'], verify: { commands: ['node -e 0'] }, acceptance: ['A1'] }] } }], { root: dir });
  const pack = { ...res.pack };
  delete pack.ready; delete pack.critical_gaps;
  return { pack, ids: res.plan.tasks.map((t) => ({ id: t.id })) };
}
const goodTask = { id: 'T1', mode: 'mutating', exact_paths: ['src/a.ts'], symbols: [{ name: 'a', kind: 'function', path: 'src/a.ts' }], expected_checks: ['node -e 0'] };

describe('OXB-C25: IMPLEMENTATION-PACK.json ready', () => {
  it('plan build writes ready: true (and critical_gaps: []) when its own checks pass', () => {
    const dir = repo();
    const res = planBuild.build([{ file: 'role.json', doc: { role: 'x', tasks: [{ rid: 'R1', title: 'doc', files: ['README.md'], verify: { commands: ['node -e 0'] }, acceptance: ['A1'] }] } }], { root: dir });
    assert.deepEqual(res.errors, []);
    assert.equal(res.pack.ready, true);
    assert.deepEqual(res.pack.critical_gaps, []);
  });

  it('a pack without ready is a NAMED gap, never an empty not_ready', () => {
    const dir = repo();
    writePack(dir, { schema_version: 1, tasks: [goodTask] });
    const s = rationality.summarizeImplementationPack(packFile(dir), [{ id: 'T1' }]);
    assert.equal(s.ready, false);
    assert.ok(s.criticalGaps.some((g) => /implementation_pack:ready missing/.test(g)), s.criticalGaps.join('\n'));
  });

  it('plan pack ready marks it only when no other critical gap remains; recorded with by/at', () => {
    const dir = repo();
    const built = builtPack(dir);
    writePack(dir, { ...built.pack, critical_gaps: ['T1 sem fixture'] });
    assert.throws(() => op.runtimePlanPackReady(dir, null, {}), /--by/);
    assert.throws(() => op.runtimePlanPackReady(dir, null, { by: 'planner' }), /lacuna\(s\) crítica\(s\)[\s\S]*T1 sem fixture/);
    writePack(dir, built.pack);
    const dry = op.runtimePlanPackReady(dir, null, { by: 'planner', dryRun: true });
    assert.equal(dry.changed, false);
    assert.equal(JSON.parse(fs.readFileSync(packFile(dir), 'utf8')).ready, undefined, 'dry-run writes nothing');
    const out = op.runtimePlanPackReady(dir, null, { by: 'planner', reason: 'pack de antes do C25' });
    assert.equal(out.changed, true);
    const pack = JSON.parse(fs.readFileSync(packFile(dir), 'utf8'));
    assert.equal(pack.ready, true);
    assert.equal(pack.ready_marked.by, 'planner');
    assert.equal(rationality.summarizeImplementationPack(packFile(dir), built.ids).criticalGaps.some((g) => /ready missing/.test(g)), false);
  });
});

describe('OXB-C24-2: plan pack fix --signature', () => {
  it('sets the signature plan skeleton needs, recorded in fixes', () => {
    const dir = repo();
    writePack(dir, { schema_version: 1, ready: true, tasks: [goodTask] });
    const out = op.runtimePlanPackFix(dir, null, { task: 'T1', symbol: 'src/a.ts#a', signature: '(id: string) => Promise<void>', by: 'planner', reason: 'o build não leva a assinatura' });
    assert.equal(out.change, 'signature');
    const entry = JSON.parse(fs.readFileSync(packFile(dir), 'utf8')).tasks[0];
    assert.equal(entry.symbols[0].signature, '(id: string) => Promise<void>');
    assert.equal(entry.symbols[0].exported, undefined, 'a signature fix does not touch exported');
    assert.equal(entry.fixes[0].change, 'signature');
  });
});

describe('OXB-C26: runtime execute --dry-run / --preflight-only', () => {
  it('runs only the preflight: no run starts, the exit code says whether execute would start', () => {
    const dir = repo();
    for (const flag of ['--dry-run', '--preflight-only']) {
      const r = spawnSync(process.execPath, [CLI, 'runtime', 'execute', flag, '--dir', dir], { encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1', NO_COLOR: '1' } });
      assert.match(`${r.stdout}${r.stderr}`, /preflight do runtime execute \(nenhuma tarefa iniciada\)/, `${flag}: ${r.stdout}${r.stderr}`);
      assert.equal(r.status, 1, `${flag}: without a plan the execute would refuse`);
    }
    assert.ok(!op.readEvents(dir, null).some((e) => /^(RunStarted|AttemptStarted)$/.test(e.type)), 'nothing ran');
  });
});

describe('OXB-C27-2: plan lint --precheck-e2e (red on the contract, not on setup)', () => {
  const pre = require('../bin/lib/oxe-test-precheck.cjs');
  it('redReason: assertion vs setup vs selector', () => {
    assert.equal(pre.redReason("AssertionError: expected 2 to equal 3").kind, 'assertion');
    assert.equal(pre.redReason("Error: browserType.launch: Executable doesn't exist").kind, 'setup');
    assert.equal(pre.redReason('Error: connect ECONNREFUSED 127.0.0.1:5173').kind, 'setup');
    const sel = pre.redReason("locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Paleta' })");
    assert.equal(sel.kind, 'selector');
    assert.match(sel.selector, /getByRole/);
    assert.equal(pre.redReason("Error: expect(locator).toHaveText(expected)\nExpected: \"3 itens\"\nReceived: \"2 itens\"").kind, 'assertion');
    assert.equal(pre.isE2e({ command: 'npx playwright test tests/e2e/pp-05-13.spec.ts' }), true);
    assert.equal(pre.isE2e({ command: 'npx vitest run tests/unit/a.test.ts' }), false);
  });

  it('e2e mode runs once; setup red is an error, selector red a warning (error by config), assertion red is clean', () => {
    const dir = repo();
    const doc = { tasks: [{ id: 'T3', title: 'paleta' }], acceptance_tests: [
      { id: 'pp-05-13', criterion: 'A1', task: 'T3', command: 'npx playwright test e2e/a.spec.ts', files: [] },
      { id: 'pp-05-14', criterion: 'A2', task: 'T3', command: 'npx playwright test e2e/b.spec.ts', files: [] },
      { id: 'pp-05-15', criterion: 'A3', task: 'T3', command: 'npx playwright test e2e/c.spec.ts', files: [] },
    ] };
    const outputs = {
      'npx playwright test e2e/a.spec.ts': 'Error: connect ECONNREFUSED 127.0.0.1:5173',
      'npx playwright test e2e/b.spec.ts': "locator.click: Timeout 30000ms exceeded.\n  - waiting for getByTestId('palette-open')",
      'npx playwright test e2e/c.spec.ts': 'AssertionError: expected 2 to equal 3',
    };
    let calls = 0;
    const run = (_cwd, cmd) => { calls += 1; return { code: 1, timedOut: false, output: outputs[cmd] }; };
    const ws = { create: () => dir, dispose() {} };
    const r = pre.precheck(dir, doc, null, { entries: doc.acceptance_tests, mode: 'e2e', run, workspace: ws, cachePath: false, progressPath: false });
    assert.equal(calls, 3, 'one run each');
    const byId = Object.fromEntries(r.findings.map((f) => [f.id, f]));
    assert.equal(byId['pp-05-13'].kind, 'precheck_red_on_setup');
    assert.equal(byId['pp-05-13'].level, 'error');
    assert.equal(byId['pp-05-14'].kind, 'precheck_red_on_selector');
    assert.equal(byId['pp-05-14'].level, 'warn');
    assert.equal(byId['pp-05-15'], undefined);
    const strict = pre.precheck(dir, doc, null, { entries: doc.acceptance_tests, mode: 'e2e', run, workspace: ws, cachePath: false, progressPath: false, selectorLevel: 'error' });
    assert.equal(strict.findings.find((f) => f.id === 'pp-05-14').level, 'error');
  });
});

describe('OXB-C23-1/2, C27-3: runtime promote of a program built by planner commits and quicks', () => {
  const g = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const w = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
  function program() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oxb-c27-3-'));
    dirs.push(root);
    const origin = path.join(root, 'origin.git');
    const dir = path.join(root, 'work');
    fs.mkdirSync(dir);
    g(root, 'init', '-q', '--bare', origin);
    g(dir, 'init', '-q', '-b', 'main');
    g(dir, 'config', 'user.email', 't@t'); g(dir, 'config', 'user.name', 't'); g(dir, 'config', 'core.autocrlf', 'false');
    w(dir, '.gitignore', '.oxe/\n');
    w(dir, 'src/a.js', 'module.exports = 0;\n');
    w(dir, 'src/card.js', 'module.exports = "base";\n');
    w(dir, 'tests/design-lint.test.js', 'const MAX_RAW_BUTTONS = 420;\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'base');
    g(dir, 'remote', 'add', 'origin', origin);
    g(dir, 'push', '-q', 'origin', 'main');
    g(dir, 'checkout', '-q', '-b', 'oxe/f1');
    return dir;
  }
  const plan = (dir, tasks, acceptance) => {
    w(dir, '.oxe/STATE.md', '# S\n'); w(dir, '.oxe/PLAN.md', '# P\n'); w(dir, '.oxe/config.json', '{}');
    w(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks, acceptance_tests: acceptance }, null, 2));
  };

  it('C27-3: the planner frozen-tests commit of T1+T2 is not in T1 PR; T1 frozen test goes as a file', () => {
    const dir = program();
    w(dir, 'tests/acceptance/t1.test.js', 'test("t1")\n');
    w(dir, 'tests/acceptance/t2.test.js', 'test("t2")\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'test(acceptance): frozen tests\n\nOXE-Task: F1/T1');
    const planner = g(dir, 'rev-parse', 'HEAD');
    w(dir, 'src/a.js', 'module.exports = 1;\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'feat: T1\n\nOXE-Task: F1/T1');
    const t1 = g(dir, 'rev-parse', 'HEAD');
    plan(dir, [
      { id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], acceptance: ['A1'], done: true, done_commit: t1 },
      { id: 'T2', title: 'b', wave: 1, files: ['src/b.js'], acceptance: ['A2'], done: false },
    ], [
      { criterion: 'A1', task: 'T1', files: ['tests/acceptance/t1.test.js'], command: 'node tests/acceptance/t1.test.js' },
      { criterion: 'A2', task: 'T2', files: ['tests/acceptance/t2.test.js'], command: 'node tests/acceptance/t2.test.js' },
    ]);
    const out = op.runtimePromote(dir, null, { task: 'T1', base: 'main', prReady: false, dryRun: true });
    assert.ok(!out.commits.includes(planner), `planner commit not picked: ${out.commits}`);
    assert.ok(out.commits.includes(t1));
    assert.ok(out.frozen_tests.includes('tests/acceptance/t1.test.js'));
    assert.ok(!out.frozen_tests.includes('tests/acceptance/t2.test.js'));
    assert.ok(out.warnings.some((x) => /OXB-C27-3/.test(x) && /T2/.test(x)), out.warnings.join('\n'));
  });

  it('C23-2: a scope test another task changed by QUICK is not copied from the tip; C23-1: an own-file quick outside the window is named', () => {
    const dir = program();
    w(dir, 'src/card.js', 'module.exports = "card";\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'feat: plan card\n\nOXE-Quick: Q-20261118-8442');
    const quick = g(dir, 'rev-parse', 'HEAD');
    w(dir, 'tests/design-lint.test.js', 'const MAX_RAW_BUTTONS = 415;\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'feat: T5\n\nOXE-Task: F1/T5');
    const t5 = g(dir, 'rev-parse', 'HEAD');
    w(dir, 'tests/design-lint.test.js', 'const MAX_RAW_BUTTONS = 406;\n');
    g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'fix: T10 lowers raw buttons\n\nOXE-Quick: Q-20261118-9999');
    plan(dir, [
      { id: 'T5', title: 'lint', wave: 1, files: ['tests/design-lint.test.js', 'src/card.js'], acceptance: ['A5'], done: true, done_commit: t5 },
      { id: 'T10', title: 'buttons', wave: 2, files: ['src/buttons.js'], acceptance: ['A10'], done: true },
    ], []);
    const out = op.runtimePromote(dir, null, { task: 'T5', base: 'main', prReady: false, dryRun: true });
    assert.ok(!out.frozen_tests.includes('tests/design-lint.test.js'), 'not copied from the tip (406)');
    assert.ok((out.not_carried_tests || []).includes('tests/design-lint.test.js'), 'named as not carried');
    assert.ok(!out.commits.includes(quick));
    assert.ok(out.warnings.some((x) => /OXB-C23-1/.test(x) && /Q-20261118-8442/.test(x) && /src\/card\.js/.test(x)), out.warnings.join('\n'));
  });
});

describe('OXB-C24-1/3, C27-7: role budget and swept, OXE-Plan trailer', () => {
  it('C24-1: budget_usd from the role reaches PLAN.json (largest of the group); plan task edit --budget-usd', () => {
    const dir = repo();
    const res = planBuild.build([{ file: 'role.json', doc: { role: 'x', tasks: [{ rid: 'R1', title: 'doc', files: ['README.md'], budget_usd: 12, verify: { commands: ['node -e 0'] }, acceptance: ['A1'] }] } }], { root: dir });
    assert.equal(res.plan.tasks[0].budget_usd, 12);
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'doc', wave: 1, files: ['README.md'] }] }));
    assert.throws(() => op.runtimePlanTaskEdit(dir, null, { task: 'T1', budgetUsd: '-1', by: 'planner', reason: 'teto da tarefa' }), /--budget-usd/);
    op.runtimePlanTaskEdit(dir, null, { task: 'T1', budgetUsd: '25', by: 'planner', reason: 'teto da tarefa pelo usuário' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8')).tasks[0].budget_usd, 25);
  });

  it('C24-3: swept on a non-removal task exempts an updated test from the symbols requirement', () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'old.test.ts'), 'test("x")\n');
    const res = planBuild.build([{ file: 'role.json', doc: { role: 'x', tasks: [{ rid: 'R1', title: 'upd', files: ['tests/old.test.ts'], swept: ['tests/old.test.ts'], verify: { commands: ['node -e 0'] }, acceptance: ['A1'] }] } }], { root: dir });
    const entry = res.pack.tasks[0];
    assert.deepEqual(entry.swept_paths, ['tests/old.test.ts']);
    assert.ok(!rationality.validatePackTask(entry).gaps.some((g) => /sem symbols/.test(g)));
  });

  it('C27-7: OXE-Plan is accepted for a tests-only planner commit, refused when it changes code', () => {
    const origin = require('../bin/lib/oxe-origin.cjs');
    const ok = origin.planTrailerVerdict('test(acceptance): frozen tests\n\nOXE-Plan: polish2/F1', ['tests/acceptance/t1.test.ts', 'e2e/pp-05-13.spec.ts']);
    assert.equal(ok.ok, true);
    const bad = origin.planTrailerVerdict('x\n\nOXE-Plan: polish2/F1', ['tests/a.test.ts', 'src/app.ts']);
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /src\/app\.ts/);
    assert.equal(origin.planTrailerVerdict('no trailer', []), null);
  });
});
