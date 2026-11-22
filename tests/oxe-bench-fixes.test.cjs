'use strict';

// Bench OXE × Restitui (21-22/11): the findings that were confirmed in the code and fixed here.
// B01/B22 are in oxe-agent-install.test.cjs; the grill playback (B06) in the grill tests that confirm branches.

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const health = require('../bin/lib/oxe-project-health.cjs');
const programLib = require('../bin/lib/oxe-program.cjs');
const dossier = require('../bin/lib/oxe-dossier.cjs');
const specEdit = require('../bin/lib/oxe-spec-edit.cjs');
const decisions = require('../bin/lib/oxe-decisions.cjs');
const grill = require('../bin/lib/oxe-grill.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, OXE_NO_PROMPT: '1' } });

function project({ tasks, phaseStatus = 'planning' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-bench-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, phase: 'F1', tasks: tasks || [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'] }] }, null, 2));
  const ph = (id, status) => ({ id, title: id, requirements: [], acceptance: ['A1'], scope: null, status, plan_ref: null, run_id: null, started_at: 'x', closed_at: null, closed_commit: null, regression_ref: null, interfaces_ref: null });
  fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, roadmap_ref: null, active_phase: 'F1', created_at: 'x', updated_at: 'x', phases: [ph('F1', phaseStatus), ph('F2', 'pending')] }, null, 2));
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const phaseOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8')).phases[0].status;

describe('bench B27/B44: the next step on the manual path (phase stays planning)', () => {
  it('plan of the phase with every task done → verify, not execute', () => {
    const dir = project({ tasks: [{ id: 'T1', title: 'a', wave: 1, files: ['src/a.js'], done: true, done_commit: 'abc' }] });
    const n = health.suggestNextStep(dir, {});
    assert.equal(n.step, 'verify', JSON.stringify(n));
    const pending = project();
    assert.equal(health.suggestNextStep(pending, {}).step, 'execute');
  });
});

describe('bench B16/B35: plan done needs evidence', () => {
  it('refuses without a commit OXE-Task; --commit must exist; --force needs a reason and moves the phase', () => {
    const dir = project();
    assert.throws(() => op.runtimePlanDone(dir, null, { task: 'T1' }), /sem commit com "OXE-Task: T1"/);
    assert.throws(() => op.runtimePlanDone(dir, null, { task: 'T1', commit: 'deadbeef' }), /não é um commit/);
    assert.throws(() => op.runtimePlanDone(dir, null, { task: 'T1', force: true }), /exige --reason/);
    const out = op.runtimePlanDone(dir, null, { task: 'T1', force: true, reason: 'entregue por outro PR revisado' });
    assert.deepEqual([out.changed, out.forced, out.commit], [true, true, null]);
    assert.equal(phaseOf(dir), 'executing', 'the manual path moves the phase');
  });

  it('the task checkpoint (OXE-Task trailer) is enough', () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1\n');
    git(dir, 'add', 'src/a.js');
    git(dir, 'commit', '-q', '-m', 'feat: a', '-m', 'OXE-Task: F1/T1');
    const out = op.runtimePlanDone(dir, null, { task: 'T1' });
    assert.equal(out.commit, git(dir, 'rev-parse', 'HEAD').stdout.trim());
  });
});

describe('bench B42: regression frozen from a whole-suite command', () => {
  it('drops `npm test` when the criterion has a scoped check, marks it otherwise', () => {
    assert.equal(programLib.isWholeSuiteCommand('npm test'), true);
    assert.equal(programLib.isWholeSuiteCommand('node --test'), true);
    assert.equal(programLib.isWholeSuiteCommand('node --test test/a.test.js'), false);
    const suite = { checks: [
      { id: 'check-a29', command: 'npm test', acceptance_ref: 'A29' },
      { id: 'check-accept-a29', command: 'node --test test/acceptance/a29.test.js', acceptance_ref: 'A29' },
      { id: 'check-a41', command: 'npm test', acceptance_ref: 'A41' },
    ] };
    const results = suite.checks.map((c) => ({ check_id: c.id, status: 'pass' }));
    const frozen = programLib.freezeRegressionChecks(results, suite);
    assert.deepEqual(frozen.map((c) => c.id), ['check-accept-a29', 'check-a41']);
    assert.equal(frozen.find((c) => c.id === 'check-a41').whole_suite, true);
  });
});

describe('bench B33: files the OXE writes are not architecture drift', () => {
  it('docs/adr/** from decision add is `generated`, not `outside`', () => {
    const drift = dossier.architectureDrift({ tasks: [] }, { tasks: [{ id: 'T1', files: ['src/a.js'] }] }, [{ path: 'src/a.js', status: 'M' }, { path: 'docs/adr/0001-x.md', status: 'A' }, { path: 'src/other.js', status: 'A' }], null, { generatedGlobs: ['docs/adr/**'] });
    assert.deepEqual(drift.outside, ['src/other.js']);
    assert.deepEqual(drift.generated, ['docs/adr/0001-x.md']);
  });
});

describe('bench B49: spec add criterion with the probe tables after the criteria', () => {
  it('writes to the acceptance criteria table, not to Proibições/Bordas', () => {
    const spec = [
      '## Critérios de aceite', '', '| ID | Critério | Como verificar | Risco |', '|---|---|---|---|', '| A1 | faz x | teste | P1 |', '',
      '## Bordas', '', '| ID | Critério | Borda | Status | Motivo / verify |', '|---|---|---|---|---|', '| B1 | A1 | vazio | aberta | |', '',
      '## Proibições', '', '| ID | Critério | Não pode | Nível | Verify |', '|---|---|---|---|---|', '| N1 | A1 | vazar segredo | julgamento | |', '',
    ].join('\n');
    const out = specEdit.addCriterion(spec, 'A2', { text: 'faz y', verify: 'teste y', risk: 'P2' });
    const text = typeof out === 'string' ? out : out.text;
    assert.match(text, /\| A1 \| faz x \| teste \| P1 \|\n\| A2 \| faz y \| teste y \| P2 \|/);
  });
});

describe('bench B11/B40: a decision the agent proposes is not the user\'s', () => {
  it('no --by = agente; --proposed blocks the plan lint until confirm --by', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-bench-dec-'));
    dirs.push(dir);
    const d1 = decisions.add(dir, { title: 'bloquear após 5 tentativas', phase: 'F1' });
    assert.equal(d1.by, 'agente');
    const d2 = decisions.add(dir, { title: 'lockout por 15 minutos', phase: 'F1', proposed: true });
    assert.equal(d2.status, 'proposed');
    const doc = { tasks: [{ id: 'T1', decisions: [d2.id] }] };
    assert.match(decisions.lintDecisions(doc, decisions.list(dir), 'F1').errors.join('\n'), /sem confirmação humana/);
    assert.throws(() => decisions.setStatus(dir, d2.id, { status: 'active' }), /exige --by/);
    decisions.setStatus(dir, d2.id, { status: 'active', by: 'po' });
    const confirmed = decisions.list(dir).find((x) => x.id === d2.id);
    assert.deepEqual([confirmed.status, confirmed.confirmed_by], ['active', 'po']);
    assert.deepEqual(decisions.lintDecisions(doc, decisions.list(dir), 'F1').errors, []);
  });
});

describe('bench B06: a grill branch is confirmed with its playback', () => {
  it('confirm without --playback is refused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-bench-grill-'));
    dirs.push(dir);
    grill.start(dir, { type: 'feature' });
    const q = grill.ask(dir, { branch: 'problem', question: 'Qual o problema?', recommended: 'x', options: 'x | y' });
    assert.deepEqual(q.options, ['x', 'y']);
    grill.answer(dir, q.id, { choice: 'ok' });
    assert.throws(() => grill.confirm(dir, 'problem', {}), /exige o playback/);
    assert.equal(grill.confirm(dir, 'problem', { playback: 'o problema é x, confirmado pelo usuário' }).confirmed, true);
  });
});

describe('bench B30: one line per check in VERIFY.md', () => {
  it('summarizes a TAP output', () => {
    const { checkSummaryLine } = require('../lib/runtime/projection/projection-engine.js');
    const tap = 'TAP version 13\nok 1 - a\nnot ok 2 - b | c\n# tests 2\n# pass 1\n# fail 1\n';
    assert.equal(checkSummaryLine(tap, 'x'), 'pass 1 · fail 1 · not ok 2 - b \\| c');
    assert.equal(checkSummaryLine('', 'check-a1'), 'check-a1');
    assert.ok(checkSummaryLine('y'.repeat(500), 'x').length <= 160);
  });
});

describe('bench B15/B46/B21: CLI', () => {
  it('runtime compile of an empty graph exits 1', () => {
    const dir = project();
    fs.rmSync(path.join(dir, '.oxe', 'PLAN.json'));
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | x | teste |\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n\n### T1: sem o travessão\n');
    const r = cli(dir, 'runtime', 'compile', '--dir', dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /grafo vazio/);
  });

  it('program close --accept-drift --by po does not take --by as the glob', () => {
    const dir = project();
    const r = cli(dir, 'runtime', 'program', 'close', '--accept-drift', '--by', 'po', '--dir', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--accept-drift exige um <glob>/);
  });

  it('warns when this CLI is older than the project', () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'oxe-version.json'), JSON.stringify({ oxe_version: '99.0.0' }));
    const r = cli(dir, 'status', '--json', '--dir', dir);
    assert.match(r.stderr, /mais velho que o projeto \(99\.0\.0/);
  });
});

describe('C28-9 (8e 22/11): a 404 from an unauthenticated Jira call names the credential', () => {
  it('404 on the comment + 401 on /myself → the message says the token was refused', async () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: { provider: 'jira', jira: { project: 'OXE', site_env: 'B289_SITE', email_env: 'B289_EMAIL', token_env: 'B289_TOKEN' }, states: { in_progress: 'Em andamento' } } }));
    Object.assign(process.env, { B289_SITE: 'https://example.atlassian.net', B289_EMAIL: 'x', B289_TOKEN: 'y' });
    const http = async (method, url) => (/\/myself$/.test(url) ? { status: 401, json: null, text: '', headers: {} } : { status: 404, json: null, text: 'Issue does not exist', headers: {} });
    try {
      const out = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-297', objective: 'corrigir algo pequeno', apply: true, http, sleep: async () => {}, retries: 1 });
      assert.match(String(out.alm.error), /credencial foi recusada \(GET \/rest\/api\/3\/myself → 401\)/);
    } finally {
      for (const k of ['B289_SITE', 'B289_EMAIL', 'B289_TOKEN']) delete process.env[k];
    }
  });
});

describe('C28-9 (8e 22/11): a token renewed in the User env after this process started', () => {
  it('names the stale variable (never its value)', async () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: { provider: 'jira', jira: { project: 'OXE', site_env: 'B289_SITE', email_env: 'B289_EMAIL', token_env: 'B289_TOKEN' }, states: { in_progress: 'Em andamento' } } }));
    const env = { B289_SITE: 'https://example.atlassian.net', B289_EMAIL: 'x', B289_TOKEN: 'old-token' };
    const userEnv = (name) => ({ B289_EMAIL: 'x', B289_TOKEN: 'new-token' })[name];
    const http = async (method, url) => (/\/myself$/.test(url) ? { status: 401, json: null, text: '', headers: {} } : { status: 404, json: null, text: '', headers: {} });
    const out = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-297', objective: 'corrigir algo pequeno', apply: true, http, env, userEnv, sleep: async () => {}, retries: 1 });
    assert.match(String(out.alm.error), /B289_TOKEN neste processo difere da variável de usuário/);
    assert.doesNotMatch(String(out.alm.error), /old-token|new-token/);
  });
});

describe('OXB-C30 (8e 22/11): runtime feedback --dry-run and a test release on a closed phase', () => {
  const changesOf = (dir) => { try { return fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8'); } catch { return ''; } };
  it('--dry-run writes nothing (no CR, no reopen, no event)', () => {
    const dir = project({ phaseStatus: 'closed' });
    const before = fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8');
    const r = cli(dir, 'runtime', 'feedback', '--class', 'defect', '--criteria', 'A1', '--summary', 'o fluxo quebra no celular', '--by', 'qa', '--dry-run');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[simulação\].*seria registrado.*nada foi gravado/);
    assert.equal(changesOf(dir), '');
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), 'utf8'), before);
    const out = op.runtimeFeedback(dir, null, { class: 'defect', criteria: 'A1', summary: 'o fluxo quebra no celular', dryRun: true });
    assert.equal(out.dry_run, true);
    assert.equal(out.would_reopen_phase, true);
    assert.equal(changesOf(dir), '');
    const w = cli(dir, 'runtime', 'feedback', 'withdraw', 'CR-01', '--by', 'qa', '--reason', 'só olhando', '--dry-run');
    assert.equal(w.status, 0, w.stderr);
    assert.equal(changesOf(dir), '');
  });
  it('a constraint CR on a closed phase is post-close: the phase stays closed', () => {
    const dir = project({ phaseStatus: 'closed' });
    const out = op.runtimeFeedback(dir, null, { class: 'constraint', phase: 'F1', criteria: 'A1', summary: 'liberar o teste congelado de A1', by: 'tl' });
    assert.equal(out.reopened, false);
    assert.equal(out.cr.post_close, true);
    assert.equal(phaseOf(dir), 'closed');
    assert.match(out.route.join('\n'), /segue FECHADA/);
    const d = op.runtimeFeedback(dir, null, { class: 'defect', phase: 'F1', criteria: 'A1', summary: 'o código quebra A1 de verdade', by: 'tl' });
    assert.equal(d.reopened, true);
    assert.equal(phaseOf(dir), 'planning');
  });
});

describe('OXB-C30 (8e 22/11): program phase restore-close Fn --from-history', () => {
  const setup = (crs) => {
    const dir = project({ phaseStatus: 'planning' });
    const sha = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    const file = path.join(dir, '.oxe', 'program', 'PROGRAM.json');
    const prog = JSON.parse(fs.readFileSync(file, 'utf8'));
    prog.phases[0].reopened = 1;
    prog.phases[0].history = [{ closed_at: '2026-11-17T10:00:00.000Z', closed_commit: sha, reopened_at: '2026-11-22T10:00:00.000Z', cr: 'CR-F1-1' }];
    fs.writeFileSync(file, JSON.stringify(prog, null, 2));
    const lines = crs.map((cr) => JSON.stringify({ kind: 'cr', status: 'open', phase: 'F1', criteria: ['A1'], summary: 'xxxxxxxxxx', ...cr })).join('\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), lines + '\n');
    return { dir, sha, file };
  };
  it('restores status, closed_at and closed_commit; --dry-run writes nothing', () => {
    const { dir, sha, file } = setup([{ id: 'CR-F1-1', class: 'constraint', at: '2026-11-22T10:00:00.000Z' }]);
    const before = fs.readFileSync(file, 'utf8');
    const dry = cli(dir, 'program', 'phase', 'restore-close', 'F1', '--from-history', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /\[simulação\].*planning (?:→|->) closed.*nada foi gravado/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const r = cli(dir, 'program', 'phase', 'restore-close', 'F1', '--from-history', '--by', 'tl', '--reason', 'release de teste não muda código');
    assert.equal(r.status, 0, r.stderr);
    const ph = JSON.parse(fs.readFileSync(file, 'utf8')).phases[0];
    assert.equal(ph.status, 'closed');
    assert.equal(ph.closed_at, '2026-11-17T10:00:00.000Z');
    assert.equal(ph.closed_commit, sha);
    assert.match(fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8'), /phase_restore_close/);
  });
  it('refuses when a defect landed after the close, and without --from-history / --by', () => {
    const { dir } = setup([{ id: 'CR-F1-1', class: 'constraint', at: '2026-11-22T10:00:00.000Z' }, { id: 'CR-F1-2', class: 'defect', at: '2026-11-20T10:00:00.000Z' }]);
    assert.throws(() => op.runtimeProgramPhaseRestoreClose(dir, null, { phase: 'F1', fromHistory: true, by: 'tl', reason: 'release de teste' }), /CR-F1-2 \(defect/);
    assert.throws(() => op.runtimeProgramPhaseRestoreClose(dir, null, { phase: 'F1', by: 'tl', reason: 'release de teste' }), /--from-history/);
    assert.throws(() => op.runtimeProgramPhaseRestoreClose(dir, null, { phase: 'F1', fromHistory: true }), /--by/);
    const bad = cli(dir, 'program', 'phase', 'edit', 'F1', '--dry-run');
    assert.notEqual(bad.status, 0);
  });
});

describe('bench B55: one run per identical verify command', () => {
  it('two checks with the same command spawn it once; each is still judged on its own (proves)', async () => {
    const rt = require('../lib/runtime/index.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-b55-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'count.js'), "require('fs').appendFileSync('runs.txt','x');console.log('ok 1 - soma');\n");
    const cmd = 'node count.js';
    const check = (id, proves) => ({ id, type: 'custom', command: cmd, evidence_type_expected: 'command_output', acceptance_ref: id, description: id, ...(proves ? { proves } : {}) });
    const out = await rt.executeSuite({ checks: [check('A1'), check('A2', ['soma']), check('A3', ['nao-existe'])] }, dir, { runId: 'r', workItemId: 'w' });
    assert.equal(fs.readFileSync(path.join(dir, 'runs.txt'), 'utf8'), 'x');
    const by = Object.fromEntries(out.results.map((r) => [r.check_id, r]));
    assert.equal(by.A1.status, 'pass');
    assert.equal(by.A2.status, 'pass');
    assert.equal(by.A2.reused_run, true);
    assert.equal(by.A3.status, 'fail');
    assert.match(by.A3.error, /proof_not_executed/);
    // a new suite runs it again
    await rt.runSuite({ checks: [check('A1')] }, dir);
    assert.equal(fs.readFileSync(path.join(dir, 'runs.txt'), 'utf8'), 'xx');
  });
});

describe('bench B52: a wall-clock NFR frozen as acceptance is flagged by plan lint', () => {
  it('warns on a p95 / elapsed-ms bound, not on a behavioral test', () => {
    const pj = require('../bin/lib/oxe-plan-json.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-b52-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', 'perf.test.js'), "const t0 = performance.now(); run(); const p95 = percentile(samples, 95);\nassert.ok(p95 < 200);\n");
    fs.writeFileSync(path.join(dir, 'test', 'flow.test.js'), "assert.equal(res.status, 201);\n");
    const plan = { tasks: [{ id: 'T1', title: 'x', wave: 1, files: ['src/a.js'], verifyCommand: 'node --test', acceptance: ['A1', 'A2'] }],
      acceptanceTests: [{ criterion: 'A1', files: ['test/perf.test.js'] }, { criterion: 'A2', files: ['test/flow.test.js'] }] };
    const out = pj.lintPlan({ plan, projectRoot: dir });
    const w = out.warnings.join('\n');
    assert.match(w, /A1: test\/perf\.test\.js afirma um limite de tempo de parede.*B52/);
    assert.doesNotMatch(w, /A2: test\/flow\.test\.js afirma/);
  });
});

describe('bench B60: a reopened phase is announced by the next step', () => {
  it('reason starts with the reopen and the step carries alert', () => {
    const dir = project({ phaseStatus: 'planning' });
    const file = path.join(dir, '.oxe', 'program', 'PROGRAM.json');
    const prog = JSON.parse(fs.readFileSync(file, 'utf8'));
    prog.phases[0].reopened = 1;
    prog.phases[0].history = [{ closed_at: '2026-11-21T23:00:00.000Z', closed_commit: null, reopened_at: '2026-11-22T00:10:00.000Z', cr: 'CR-04' }];
    fs.writeFileSync(file, JSON.stringify(prog, null, 2));
    const next = health.suggestNextStep(dir, {});
    assert.match(next.alert || '', /F1 foi REABERTA por CR-04/);
    assert.match(next.reason, /^⚠ F1 foi REABERTA/);
  });
});
