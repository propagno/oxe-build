'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const review = require('../bin/lib/oxe-review.cjs');

// 1.21.2 — OXB-178b (independent review with a receipt), OXB-179 (findings ledger between rounds), OXB-139 (bounded
// rounds, escalation), OXB-180 (author's response), OXB-181 (context-free read of spec and plan).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-rv-'));
  dirs.push(dir);
  write(dir, '.gitignore', '.oxe/\n');
  write(dir, '.oxe/STATE.md', '# S\n');
  write(dir, '.oxe/DISCUSS.md', '# segredo da conversa\n');
  write(dir, '.oxe/PLAN.md', '# PLAN\n\n## T1\nAtualizar o serviço de autenticação.\n');
  write(dir, '.oxe/SPEC.md', '# SPEC\n\nVer [o contrato](docs/contrato.md), `src/auth.js`, [fora](../fora.md) e https://example.com/x.\n\n## Critérios de aceite\n\n| ID | Critério | Como verificar |\n|---|---|---|\n| A1 | O login usa o Portal Vex | teste |\n');
  write(dir, '.oxe/ROADMAP.md', '# R\n\n## Fase 1 — Base\n\n**Critérios de aceite:** A1\n');
  write(dir, '.oxe/config.json', JSON.stringify({ project_env_check: false, review: { max_rounds: 2 } }));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, tasks: [{ id: 'T1', title: 'Atualizar o serviço de autenticação', wave: 1, files: ['src/auth.js'], acceptance: ['A1'], verify: { commands: ['node -e 0'] } }] }));
  write(dir, 'docs/contrato.md', 'contrato v1\n');
  write(dir, 'src/auth.js', 'function login() { return 1 }\nmodule.exports = { login };\n');
  fs.writeFileSync(path.join(path.dirname(dir), 'fora.md'), 'fora do repo');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b');
  write(dir, 'src/auth.js', 'function login() { return 2 }\nmodule.exports = { login };\n');
  git(dir, 'commit', '-qam', 'feat: T1', '-m', 'OXE-Task: T1');
  op.runtimeProgramInit(dir, null, {});
  op.runtimeProgramStart(dir, null, 'F1');
  return dir;
}
const reply = (findings, summary = null) => ({ ok: true, pid: 4242, text: JSON.stringify({ result: JSON.stringify({ summary, findings }) }) });
const fake = (...replies) => { const prompts = []; let i = 0; const fn = async (prompt) => { prompts.push(prompt); const r = replies[Math.min(i, replies.length - 1)]; i += 1; return typeof r === 'function' ? r(prompt) : r; }; fn.prompts = prompts; return fn; };
const HIGH_AT = (line) => ({ file: 'src/auth.js', line, rule: 'contract-break', text: 'login muda o retorno sem o critério pedir' });

describe('OXB-178b: independent review with a receipt', () => {
  it('the receipt hashes what was delivered; no plan/runtime/DISCUSS for the auditor; cited in-repo files enter, outside ones wait', async () => {
    const dir = project();
    const rv = fake(reply([]));
    const out = await op.runtimeReview(dir, null, { role: 'auditor', task: 'T1', reviewer: rv });
    assert.equal(out.status, 'ran');
    const rc = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'reviews', out.id, 'receipt.json'), 'utf8'));
    const paths = rc.files.map((f) => f.path);
    assert.ok(paths.includes('.oxe/SPEC.md') && paths.includes('diff') && paths.includes('task:T1') && paths.includes('docs/contrato.md') && paths.includes('src/auth.js'), paths.join(','));
    assert.ok(!paths.some((p) => /PLAN|runs|DISCUSS|EVENTS/.test(p)), paths.join(','));
    assert.equal(rc.files.find((f) => f.path === 'docs/contrato.md').sha256, sha('contrato v1\n'));
    assert.deepEqual(rc.external_pending.sort(), ['../fora.md', 'https://example.com/x'].sort());
    assert.ok(rc.process.reviewer_pids.includes(4242) && rc.process.executor_pid === process.pid);
    assert.ok(!rv.prompts[0].includes(review.sentinel(dir)), 'the reviewer never receives the executor sentinel');
    assert.ok(!rv.prompts[0].includes('segredo da conversa'));
  });

  it('a reply with the executor sentinel invalidates the review; two failures → not_run (never approved)', async () => {
    const dir = project();
    const leak = await op.runtimeReview(dir, null, { role: 'auditor', task: 'T1', reviewer: fake(() => ({ ok: true, text: `tudo certo ${review.sentinel(dir)}` })) });
    assert.equal(leak.status, 'invalid');
    assert.equal(leak.clean, false);
    const dead = await op.runtimeReview(dir, null, { role: 'diff', task: 'T1', reviewer: fake({ ok: false, error: 'timeout' }) });
    assert.equal(dead.status, 'not_run');
    assert.equal(dead.receipt.attempts.length, 2);
    assert.equal(dead.clean, false, 'a not_run round is never clean');
    await assert.rejects(() => op.runtimeReview(dir, null, { role: 'diff', reviewer: fake(reply([])) }), /sem intenção/);
  });

  it('cited paths: inside the repo enter, outside need approval, missing are ignored', () => {
    const dir = project();
    const c = review.citedPaths(dir, '[a](docs/contrato.md) `src/nao-existe.js` [b](../fora.md) https://x.y/z');
    assert.deepEqual(c.inside, ['docs/contrato.md']);
    assert.deepEqual(c.outside, ['../fora.md', 'https://x.y/z']);
  });
});

describe('OXB-179 / OXB-139 / OXB-180: rounds, ledger, responses', () => {
  it('a high finding in two rounds in a row escalates to a spec_gap CR (review_repeat), no third round', async () => {
    const dir = project();
    const rv = fake(reply([HIGH_AT(1)]), reply([HIGH_AT(3)]));
    const r1 = await op.runtimeReview(dir, null, { role: 'diff', task: 'T1', reviewer: rv });
    assert.equal(r1.decision.action, 'next_round');
    const r2 = await op.runtimeReview(dir, null, { role: 'diff', task: 'T1', reviewer: rv });
    assert.deepEqual(r2.repeated, ['diff-1-1'], 'same rule, same file, line within tolerance');
    assert.equal(r2.decision.action, 'escalate');
    assert.match(String(r2.escalated), /^CR-/);
    const changes = fs.readFileSync(path.join(dir, '.oxe', 'program', 'changes.ndjson'), 'utf8');
    assert.match(changes, /"origin":"review_repeat"/);
    assert.match(changes, /"class":"spec_gap"/);
  });

  it('disputed in round 1 and repeated in round 2 does not reopen; fixed and repeated reopens; clean then dirty does not converge', async () => {
    const dir = project();
    const rv = fake(reply([HIGH_AT(1), { file: 'docs/contrato.md', line: 1, rule: 'behavior-wrong', text: 'x' }]), reply([HIGH_AT(2), { file: 'docs/contrato.md', line: 1, rule: 'behavior-wrong', text: 'x' }]), reply([]), reply([HIGH_AT(40)]));
    await op.runtimeReview(dir, null, { role: 'diff', task: 'T1', reviewer: rv, id: 'r' });
    // dispute without ref is refused; with a file outside the receipt is refused; with the delivered file + symbol passes
    await assert.rejects(async () => op.runtimeReview(dir, null, { action: 'respond', fid: 'diff-1-1', respond: { dispute: true } }), /exige --ref/);
    await assert.rejects(async () => op.runtimeReview(dir, null, { action: 'respond', fid: 'diff-1-1', respond: { dispute: true, ref: 'README.md#x' } }), /não estava no recibo/);
    await assert.rejects(async () => op.runtimeReview(dir, null, { action: 'respond', fid: 'diff-1-1', respond: { fix: true, severity: 'low' } }), /não muda a severidade/);
    await op.runtimeReview(dir, null, { action: 'respond', fid: 'diff-1-1', respond: { dispute: true, ref: 'src/auth.js#login' } });
    await op.runtimeReview(dir, null, { action: 'respond', fid: 'diff-1-2', respond: { fix: true, commit: 'abc123' } });
    const r2 = await op.runtimeReview(dir, null, { role: 'diff', task: 'T1', reviewer: rv, id: 'r' });
    assert.deepEqual(r2.repeated, ['diff-1-1']);
    assert.deepEqual(r2.reopened, ['diff-1-2']);
    assert.equal(r2.clean, true, 'the reopened one is medium; the disputed high stays closed');
    const st = review.status(dir, 'r');
    assert.equal(st.open.find((f) => f.fid === 'diff-1-2').reopened, 'correção falhou ou foi desfeita');
    // clean + clean converges; but here r2 was clean after a dirty r1 → not converged; r3 clean → converged
    assert.equal(r2.converged, false);
    const r3 = await op.runtimeReview(dir, null, { role: 'diff', task: 'T1', reviewer: rv, id: 'r' });
    assert.equal(r3.converged, true);
  });

  it('ping-pong: a new finding inside a fix applied in this review stops the loop with the three-way question', () => {
    const dir = project();
    review.recordRound(dir, 'pp', { role: 'diff', findings: [{ file: 'src/a.js', line: 10, rule: 'behavior-wrong', severity: 'medium', text: 'a' }] });
    review.respond(dir, 'pp', 'diff-1-1', { fix: true, commit: 'c1' });
    const r2 = review.recordRound(dir, 'pp', { role: 'diff', findings: [{ file: 'src/a.js', line: 14, rule: 'crash', severity: 'high', text: 'o fix quebrou' }] });
    assert.equal(r2.ping_pong.length, 1);
    const d = review.decideAfterRound(dir, 'pp', { max_rounds: 5 });
    assert.equal(d.action, 'stop_ping_pong');
    assert.equal(review.readLedger(dir, 'pp').decisions[0].options.length, 3);
  });

  it('a "não entendi" cannot be disputed; registering the fact creates a D-* decision; to-owner first in the status', () => {
    const dir = project();
    review.recordRound(dir, 'u', { role: 'reader', findings: [{ criterion: 'A1', rule: 'unclear-section', severity: 'high', text: 'não sei o que é Portal Vex' }, { criterion: 'A1', rule: 'undefined-term', severity: 'medium', text: 'Portal Vex' }] });
    assert.throws(() => review.respond(dir, 'u', 'reader-1-1', { dispute: true, ref: 'D-1' }), /não se contesta/);
    review.respond(dir, 'u', 'reader-1-2', { toOwner: true, reason: 'convenção do time, só em conversa' });
    assert.equal(review.status(dir, 'u').to_owner[0].fid, 'reader-1-2');
    const out = review.respond(dir, 'u', 'reader-1-2', { ownerRecord: 'Portal Vex é o SSO interno (sso.vex)', by: 'po' });
    assert.match(out.decision, /^D-/);
  });
});

describe('OXB-181: context-free read of the spec and plan', () => {
  it('the implementer points at the vague task, the reader at the undefined term; the summary is shown; a high finding blocks the execute until answered', async () => {
    const dir = project();
    const rv = async (prompt) => (/implementar este plano/.test(prompt)
      ? reply([{ task: 'T1', rule: 'open-choice', text: 'T1: qual a assinatura nova de login e qual arquivo?' }])
      : reply([{ criterion: 'A1', rule: 'undefined-term', text: 'Portal Vex sem definição' }], { delivers: 'Troca o login para o Portal Vex.', works_today: 'Login local.' }));
    const out = await op.runtimePlanRead(dir, null, { reviewer: rv });
    assert.equal(out.roles.length, 2);
    const md = fs.readFileSync(path.join(dir, '.oxe', 'PLAN-READ.md'), 'utf8');
    assert.match(md, /Troca o login para o Portal Vex/);
    assert.match(md, /open|implementer-1-1 \(high\) T1/);
    const rcR = review.readReceipt(dir, 'plan-read-reader');
    assert.ok(!rcR.files.some((f) => /DISCUSS/.test(f.path)));
    let pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(pre.blockers.some((b) => b.startsWith('plan_read:implementer-1-1')), pre.blockers.join('\n'));
    assert.ok(!pre.blockers.some((b) => b.startsWith('plan_read:reader-')), 'medium does not block');
    review.respond(dir, 'plan-read-implementer', 'implementer-1-1', { waive: true, reason: 'decidido no refinamento', by: 'tl' });
    pre = op.buildRuntimeExecutePreflight(dir, null, null, { nativeCheck: false });
    assert.ok(!pre.blockers.some((b) => b.startsWith('plan_read:')));
  });
});
