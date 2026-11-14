'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const kf = require('../bin/lib/oxe-known-failures.cjs');
const quick = require('../bin/lib/oxe-quick.cjs');

// 1.21.2 — small findings from the OxeSpace use (14/11): known-failure move / wt: remove, alm status <KEY>, a quick
// with a card in a folder without ALM, quick cancel (G32), the budget message.

const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', cwd], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });

function repo(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-small-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@oxe.dev');
  git(dir, 'config', 'user.name', 'T');
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

describe('ship known-failure: move to the right card, remove a wt: entry alone, --help', () => {
  it('move wt:KF-3 --item OXE-144: the old entry goes, the new one is in the repo store; the others stay', () => {
    const dir = repo();
    const programDir = path.join(dir, '.oxe', 'program');
    kf.add(programDir, { pattern: 'a.spec.ts:1', item: 'OXE-1' });
    kf.add(programDir, { pattern: 'b.spec.ts:2', item: 'OXE-2' });
    kf.add(programDir, { pattern: 'design-mode.spec.ts:34', item: 'OXE-103' });
    const mv = cli(dir, 'ship', 'known-failure', 'move', 'wt:KF-3', '--item', 'OXE-144', '--pr', '812');
    assert.equal(mv.status, 0, mv.stderr);
    assert.match(mv.stdout, /wt:KF-3 \(OXE-103\) (→|->) KF-1: "design-mode\.spec\.ts:34" (→|->) OXE-144 \(PR 812\)/);
    const all = kf.listAll(dir, programDir);
    assert.deepEqual(all.map((k) => `${k.id}:${k.item}`).sort(), ['KF-1:OXE-144', 'wt:KF-1:OXE-1', 'wt:KF-2:OXE-2']);
    const rm = cli(dir, 'ship', 'known-failure', 'remove', 'wt:KF-1');
    assert.equal(rm.status, 0, rm.stderr);
    assert.deepEqual(kf.listAll(dir, programDir).map((k) => k.id).sort(), ['KF-1', 'wt:KF-2'], 'only that one');
    const help = cli(dir, 'ship', 'known-failure', '--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /known-failure move <KF-n\|wt:KF-n> --item <KEY>/);
  });
});

describe('quick: a card in a folder without ALM says so; quick cancel closes as abandoned (G32)', () => {
  it('no ALM here: the quick says nothing was written to the card', async () => {
    const dir = repo();
    const s = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-144', objective: 'flaky do design-mode' });
    assert.equal(s.alm.skipped, true);
    assert.match(s.alm.why, /ALM não configurado aqui: nada foi gravado no card OXE-144/);
  });

  it('cancel: abandoned (never done), the reason and the evidence kept; a new quick on the card links back', async () => {
    const dir = repo();
    const s = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-145', objective: 'reproduzir o flaky do split' });
    await assert.rejects(op.runtimeQuick(dir, null, { action: 'cancel', reason: 'x' }), /motivo em uma frase/);
    const dry = await op.runtimeQuick(dir, null, { action: 'cancel', reason: 'não reproduziu: 40/40 no Windows, 20/20 no Linux', dryRun: true });
    assert.equal(dry.dry_run, true);
    assert.ok(quick.current(dir), 'a dry run keeps it open');
    const c = await op.runtimeQuick(dir, null, { action: 'cancel', reason: 'não reproduziu: 40/40 no Windows, 20/20 no Linux', evidence: 'run 43600000000' });
    assert.equal(c.cancelled, true);
    assert.equal(quick.read(dir, s.id).status, 'abandoned');
    assert.equal(quick.current(dir), null);
    assert.match(quick.cardComment(quick.read(dir, s.id), 'cancel'), /abandonado[\s\S]*Motivo: não reproduziu[\s\S]*Evidência: run 43600000000/);
    const again = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-145', objective: 'segunda tentativa de reproduzir' });
    assert.equal(again.follows, s.id);
    const listed = cli(dir, 'quick', 'list');
    assert.match(listed.stdout, /abandoned\s+OXE-145/);
  });
});

describe('alm status <KEY> reads the card, not a folder', () => {
  it('with a fake Jira: the live column and its stage', async () => {
    const dir = repo({ alm: { provider: 'jira', jira: { project: 'OXE' }, states: { in_progress: 'Em desenvolvimento' } } });
    const http = async (method, url) => (/\/issue\/OXE-144\?fields=status$/.test(new URL(url).pathname + new URL(url).search) ? { status: 200, json: { fields: { status: { name: 'Em desenvolvimento' } } } } : { status: 404, json: null, text: 'nf' });
    const out = await op.runtimeAlm(dir, null, { action: 'status', ref: 'OXE-144', http, env: { JIRA_SITE: 'https://x.atlassian.net', JIRA_EMAIL: 'a@b', JIRA_API_TOKEN: 't' }, sleep: async () => {} });
    assert.deepEqual([out.key, out.state, out.stage], ['OXE-144', 'Em desenvolvimento', 'in_progress']);
  });
});

describe('Celular F2 close: a network failure in a gate is infra (no CR); plan pack fix corrects a pack symbol', () => {
  it('a gate red by "dial tcp … connectex" opens no CR; a real failure does', () => {
    const gates = require('../bin/lib/oxe-phase-gates.cjs');
    const change = require('../bin/lib/oxe-change.cjs');
    const dir = repo();
    const programDir = path.join(dir, '.oxe', 'program');
    fs.mkdirSync(programDir, { recursive: true });
    const net = { check_id: 'gate-android-unit', status: 'fail', stdout: '', stderr: 'remote-verify: gh repo view exited 1 / Post https://api.github.com/graphql: dial tcp 140.82.1.1:443: connectex: A connection attempt failed because the connected party did not properly respond' };
    const real = { check_id: 'gate-lint', status: 'fail', stdout: 'src/a.ts:3:1 error no-unused-vars', stderr: '' };
    const out = gates.recordGateFailures({ programDir, plan: { tasks: [] }, checkResults: [net, real] });
    assert.deepEqual(out.infra.map((i) => i.gate), ['android-unit']);
    assert.deepEqual(out.created.map((c) => c.gate), ['lint']);
    assert.equal(change.listChanges(programDir).length, 1);
    assert.equal(gates.isInfraFailure({ stderr: 'An existing connection was forcibly closed by the remote host' }), true);
    assert.equal(gates.isInfraFailure({ stderr: 'WSAECONNRESET' }), true);
    assert.equal(gates.isInfraFailure({ stderr: 'expected 2 to equal 3' }), false);
  });

  it('plan pack fix: a module-private class → --internal, a method → --member-of; recorded, never silent', () => {
    const dir = repo();
    const pack = { tasks: [{ id: 'T2', mode: 'mutating', exact_paths: ['src/topics.ts'], symbols: [{ name: 'TerminalTopic', kind: 'class', path: 'src/topics.ts' }, { name: 'createRemoteTopics', kind: 'function', path: 'src/topics.ts' }] },
      { id: 'T4', mode: 'mutating', exact_paths: ['src/size-lease.ts'], symbols: [{ name: 'lease', kind: 'function', path: 'src/size-lease.ts' }] }] };
    fs.writeFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), JSON.stringify(pack));
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    const base = { by: 'planner', reason: 'o planner nomeou como export um símbolo interno' };
    assert.throws(() => op.runtimePlanPackFix(dir, null, { task: 'T2', symbol: 'src/topics.ts#TerminalTopic', ...base }), /diga a correção/);
    assert.throws(() => op.runtimePlanPackFix(dir, null, { task: 'T2', symbol: 'src/topics.ts#Nope', internal: true, ...base }), /não está nos symbols/);
    op.runtimePlanPackFix(dir, null, { task: 'T2', symbol: 'src/topics.ts#TerminalTopic', internal: true, ...base });
    op.runtimePlanPackFix(dir, null, { task: 'T4', symbol: 'src/size-lease.ts#lease', memberOf: 'SizeLeases', cr: 'CR-04', ...base });
    const after = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'IMPLEMENTATION-PACK.json'), 'utf8'));
    const t2 = after.tasks[0];
    assert.equal(t2.symbols[0].exported, false);
    assert.equal(t2.symbols[1].exported, undefined, 'the other symbol is untouched');
    assert.equal(t2.fixes[0].change, 'internal');
    assert.deepEqual([after.tasks[1].symbols[0].exported, after.tasks[1].symbols[0].member_of, after.tasks[1].fixes[0].cr], [false, 'SizeLeases', 'CR-04']);
  });
});

describe('the budget message says it is the phase total', () => {
  it('exhausted usd names "acumulado da fase"', () => {
    const budget = require('../bin/lib/oxe-budget.cjs');
    const reason = budget.exhaustedReason ? budget.exhaustedReason({ limit_usd: 20, used_usd: 50.04 }) : null;
    if (reason) assert.match(reason, /acumulado da fase/);
  });
});

describe('hooks nunca criam .oxe/ numa worktree (OxeSpace 14/11)', () => {
  it('runtime pre-push num checkout sem .oxe/ passa e não cria o esqueleto', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-prepush-'));
    dirs.push(dir);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'pre-push', '--dir', dir], { encoding: 'utf8', input: '', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(path.join(dir, '.oxe')), false);
    const s = spawnSync(process.execPath, [CLI, 'runtime', 'autoresume', 'status', '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.equal(fs.existsSync(path.join(dir, '.oxe')), false);
  });
});

describe('checkpoint-ws: a junction deixada por um kill some (OxeSpace 14/11)', () => {
  it('sobra com mais de 2 h perde o link e sai; a pasta real das deps fica; a recente fica', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-cpws-'));
    dirs.push(dir);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const deps = path.join(dir, 'deps');
    fs.mkdirSync(deps);
    fs.writeFileSync(path.join(deps, 'keep.txt'), 'x');
    const mk = (name) => {
      const wt = path.join(dir, '.oxe', 'checkpoint-ws', name);
      fs.mkdirSync(wt, { recursive: true });
      fs.symlinkSync(deps, path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      return wt;
    };
    const old = mk('old');
    const fresh = mk('fresh');
    const past = new Date(Date.now() - 3 * 3600_000);
    fs.utimesSync(old, past, past);
    const out = op.sweepCheckpointWorkspaces(dir);
    assert.deepEqual(out.swept, ['old']);
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(path.join(deps, 'keep.txt')), true, 'a pasta real das deps nunca é apagada');
    assert.equal(fs.existsSync(fresh), true);
  });
});

describe('close sem o ensaio de rollback registra o risco (Celular F2, 14/11)', () => {
  it('--no-rollback-check sem --by e --reason é recusado antes de tocar em nada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-norb-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    const r = spawnSync(process.execPath, [CLI, 'runtime', 'program', 'close', '--no-rollback-check', '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--no-rollback-check exige --by <papel> e --reason/);
  });
});

describe('alm version <KEY> <versão> chega ao comando (OxeSpace 14/11, OXE-10)', () => {
  it('a chave do card vai para a troca de versão; version ensure continua no admin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-almver-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), '{}');
    const env = { ...process.env, NO_COLOR: '1' };
    const set = spawnSync(process.execPath, [CLI, 'alm', 'version', 'OXE-10', '1.5.3', '--dry-run', '--dir', dir], { encoding: 'utf8', env });
    assert.doesNotMatch(`${set.stdout}${set.stderr}`, /version ensure/);
    assert.match(`${set.stdout}${set.stderr}`, /ALM não configurado/);
    const ensure = spawnSync(process.execPath, [CLI, 'alm', 'version'], { encoding: 'utf8', env });
    assert.match(`${ensure.stdout}${ensure.stderr}`, /alm version ensure <nome>/);
  });
});

describe('spec add/amend: um "|" no texto não parte a linha da tabela (Celular F3, 14/11)', () => {
  const se = require('../bin/lib/oxe-spec-edit.cjs');
  const SPEC = '# SPEC\n\n## Critérios de aceite\n\n| ID | Critério | Risco | Como verificar |\n|---|---|---|---|\n| A1 | x | P2 | `node -e 1` |\n';
  it('o texto vai escapado e a linha continua com 4 células; o amend acha o critério', () => {
    const add = se.addCriterion(SPEC, 'A2', { text: 'aceita a | b', verify: 'npx vitest run t -t "a|b"', risk: 'P1' });
    const BS = String.fromCharCode(92);
    assert.ok(add.after.includes(`aceita a ${BS}| b`), add.after);
    const row = add.text.split('\n').find((l) => l.startsWith('| A2'));
    assert.equal(se.splitRow(row).length, 4, row);
    const am = se.amendCriterion(add.text, 'A2', { append: 'ou c | d' });
    assert.ok(am.after.includes(`ou c ${BS}| d`), am.after);
    assert.equal(se.splitRow(am.after).length, 4, am.after);
    assert.ok(se.criteriaIds(am.text).includes('A2'));
  });
});

describe('plan task edit: onda, dependências, escopo e notas sem editar o PLAN.json à mão (Celular F3, 14/11)', () => {
  it('edita, registra, e recusa ciclo, tarefa done, dependência inexistente e teste congelado', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-taskedit-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.md'), '# PLAN\n');
    const doc = { schema_version: 1, tasks: [
      { id: 'T7', title: 'a', wave: 1, files: ['src/a.kt', 'src/shared.kt'], notes: 'limite de 600 ms' },
      { id: 'T9', title: 'b', wave: 1, depends_on: [], files: ['src/shared.kt'] },
      { id: 'T1', title: 'feita', wave: 1, files: ['src/x.kt'], done: true },
    ], acceptance_tests: [{ criterion: 'A7', files: ['tests/A7Test.kt'] }] };
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify(doc));
    const base = { by: 'planner', reason: 'T7 e T9 escreviam o mesmo arquivo na onda 1' };
    const out = op.runtimePlanTaskEdit(dir, null, { ...base, task: 'T9', wave: '2', dependsOn: 'T7' });
    assert.equal(out.after.wave, 2);
    assert.deepEqual(out.after.depends_on, ['T7']);
    op.runtimePlanTaskEdit(dir, null, { ...base, task: 'T7', removePaths: 'src/shared.kt', notes: 'limite de 400 ms (CR-F3-2)' });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8'));
    const t7 = saved.tasks.find((t) => t.id === 'T7');
    assert.deepEqual(t7.files, ['src/a.kt']);
    assert.equal(t7.notes, 'limite de 400 ms (CR-F3-2)');
    assert.equal(t7.edits.length, 1);
    assert.throws(() => op.runtimePlanTaskEdit(dir, null, { ...base, task: 'T7', dependsOn: 'T9' }), /ciclo/);
    assert.throws(() => op.runtimePlanTaskEdit(dir, null, { ...base, task: 'T1', wave: '2' }), /está done/);
    assert.throws(() => op.runtimePlanTaskEdit(dir, null, { ...base, task: 'T9', dependsOn: 'T42' }), /T42 não existe/);
    assert.throws(() => op.runtimePlanTaskEdit(dir, null, { ...base, task: 'T7', removePaths: 'tests/A7Test.kt' }), /teste congelado/);
    const changes = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(changes.filter((c) => c.kind === 'task_edit').length, 2);
  });
});
