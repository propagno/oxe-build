'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — OXB-G13 (P0 of the 1.5.2 refine, 14/11): `alm refine apply <15 KEYS> --dry-run` wrote to Jira. A dry run
// never reaches a write endpoint, in any command that writes: every one runs here against a fake Jira that FAILS the
// test on any POST, PUT, PATCH or DELETE (and on a transition). OXB-G14: --claim moves the card to "Em refinamento" and
// says so; when it cannot, it says why.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token', OXE_ALM_WRITER: 'oxespace-69' };
const STATES = { intake: 'Backlog', grooming: 'Em grooming', refinement: 'Em refinamento', ready: 'Pronto para desenvolvimento', in_progress: 'Em desenvolvimento', review: 'Em revisão', integrated: 'Na main', released: 'Lançado' };
const adf = (t) => ({ type: 'doc', version: 1, content: t.split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });

/** In-memory Jira. `guard: true` → any write throws (the test fails), and is recorded in `writes`. */
function fakeJira() {
  const issues = new Map();
  const writes = [];
  const reads = [];
  let n = 100;
  let guard = false;
  const names = Object.values(STATES);
  const versions = [{ id: '1', name: '1.5.2', released: false }];
  for (const k of ['OXE-20', 'OXE-21', 'OXE-22']) issues.set(k, { key: k, id: k.slice(4), fields: { summary: `card ${k}`, description: adf(`Texto original de ${k}.`), issuetype: { name: 'Tarefa' }, status: { name: 'Em grooming' }, labels: [], issuelinks: [], comment: { comments: [] }, fixVersions: [] } });
  const http = async (method, url, headers, body) => {
    const u = new URL(url);
    const p = u.pathname;
    if (method !== 'GET' && !(method === 'POST' && /\/wit\/wiql$/.test(p))) {
      writes.push(`${method} ${p}`);
      if (guard) throw Object.assign(new Error(`ESCRITA EM SIMULAÇÃO: ${method} ${p}`), { fatal: true });
    } else reads.push(`${method} ${p}`);
    if (method === 'GET' && p === '/rest/api/3/search/jql') {
      const lm = /labels = "([^"]+)"/.exec(u.searchParams.get('jql') || '');
      return { status: 200, json: { issues: [...issues.values()].filter((i) => !lm || i.fields.labels.includes(lm[1])).map((i) => ({ key: i.key, id: i.id, fields: { status: i.fields.status, summary: i.fields.summary } })) } };
    }
    if (method === 'POST' && p === '/rest/api/3/issue') { n += 1; const key = `OXE-${n}`; issues.set(key, { key, id: String(n), fields: { ...body.fields, status: { name: 'Backlog' }, issuelinks: [], comment: { comments: [] } } }); return { status: 201, json: { key, id: String(n) } }; }
    let m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
    if (m && method === 'GET') return issues.has(m[1]) ? { status: 200, json: issues.get(m[1]) } : { status: 404, json: null, text: 'nf' };
    if (m && method === 'PUT') { const it = issues.get(m[1]); if (body.fields && body.fields.description) it.fields.description = body.fields.description; if (body.fields && body.fields.summary) it.fields.summary = body.fields.summary; for (const l of (body.update && body.update.labels) || []) if (l.add && !it.fields.labels.includes(l.add)) it.fields.labels.push(l.add); for (const fv of (body.update && body.update.fixVersions) || []) if (fv.set) it.fields.fixVersions = fv.set.map((s) => versions.find((v) => v.id === s.id)); return { status: 204, json: null }; }
    m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(p);
    if (m && method === 'GET') return { status: 200, json: { transitions: names.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
    if (m && method === 'POST') { issues.get(m[1]).fields.status = { name: names[Number(body.transition.id) - 1] }; return { status: 204, json: null }; }
    m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment(?:\/(\d+))?$/.exec(p);
    if (m && method === 'GET') return { status: 200, json: { comments: issues.get(m[1]).fields.comment.comments } };
    if (m && method === 'POST') { issues.get(m[1]).fields.comment.comments.push({ id: String(Date.now()), body: body.body }); return { status: 201, json: {} }; }
    if (m && method === 'PUT') return { status: 200, json: {} };
    if (method === 'POST' && p === '/rest/api/3/issueLink') return { status: 201, json: null };
    if (method === 'GET' && /\/project\/[A-Z]+\/versions$/.test(p)) return { status: 200, json: versions };
    if (method === 'GET' && /\/project\/[A-Z]+$/.test(p)) return { status: 200, json: { id: '10000', key: 'OXE' } };
    if (method === 'POST' && p === '/rest/api/3/version') return { status: 201, json: { id: '2' } };
    if (p === '/rest/dev-status/latest/issue/summary') return { status: 200, json: { summary: {} } };
    return { status: 404, json: null, text: `no route ${method} ${p}` };
  };
  return { http, issues, writes, reads, versions, arm() { guard = true; writes.length = 0; }, disarm() { guard = false; } };
}

const PRD = ['---', 'oxe_doc: prd', 'version: 1', '---', '', '# PRD', '', '## Histórias de usuário', '', '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |', '|----|------|-------|------|------------|-----------|------------|', '| US-1 | operador | enviar texto | não digitar | R1 | A1 | Must |', ''].join('\n');

function project(almExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-dry-'));
  dirs.push(dir);
  write(dir, '.oxe/config.json', JSON.stringify({ docs_publish: false, adr: false, alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, writer: 'oxespace-69', states: STATES, track: ['grooming', 'refinement', 'ready', 'in_progress', 'review'], fix_version: { F1: '1.5.2' }, ...almExtra } }));
  write(dir, '.oxe/PRD.md', PRD);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'enviar texto', acceptance: ['A1'], files: ['src/send.ts'] }] }));
  write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({ active_phase: 'F1', phases: [{ id: 'F1', status: 'executing', acceptance: ['A1'] }] }));
  return dir;
}

const TASK_SPEC = (key) => `<!-- oxe-refine: ${key} · tipo task -->
# ${key} — tarefa

## Objetivo

Entregar o envio de texto em até 2 s (card).

## Contexto

- O card pede o envio (card).

## Critérios de aceite

1. **CA-1** — Dado um celular pareado, quando o operador envia um texto de até 4000 caracteres, então ele chega em até 2 s · Teste: e2e/send.spec.ts › envia texto

## Regras técnicas

- **RT-1** — Usa o bridge existente (card).

## Fora de escopo

- O app do celular.

## Dependências

- nenhuma

## Definição de pronto

- Critério com teste verde no CI

## Referências

- Card: ${key}

## Perguntas em aberto

- (nenhuma)
`;

const sleep = async () => {};

describe('OXB-G13: --dry-run never writes to the ALM, in any command', () => {
  it('the transport refuses every write in a dry run (defense in depth), and lets reads and Azure WIQL through', async () => {
    const j = fakeJira();
    const cfg = alm.almConfig({ alm: { provider: 'jira', jira: { project: 'OXE' } } });
    const rest = alm.jiraRest(cfg, { http: j.http, env: ENV, dryRun: true, sleep });
    assert.ok(await rest.request('GET', `${ENV.JIRA_SITE}/rest/api/3/issue/OXE-20`));
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) await assert.rejects(rest.request(m, `${ENV.JIRA_SITE}/rest/api/3/issue/OXE-20`, {}), (e) => e.dryRunBlocked === true);
    assert.deepEqual(j.writes, [], 'nothing left the process');
    const prov = alm.provider(cfg, { http: j.http, env: ENV, dryRun: true, sleep });
    await assert.rejects(prov.transition('OXE-20', 'Em revisão'), /simulação/);
    await assert.rejects(prov.comment('OXE-20', 'x'), /simulação/);
    assert.deepEqual(j.writes, []);
  });

  it('refine apply --dry-run with several keys: reads, says what it would do, writes nothing (the P0)', async () => {
    const dir = project();
    const j = fakeJira();
    const keys = ['OXE-20', 'OXE-21', 'OXE-22'];
    await op.runtimeAlmRefine(dir, null, { action: 'collect', keys, http: j.http, env: ENV, sleep });
    for (const k of keys) write(dir, `.oxe/alm/specs/${k}.md`, TASK_SPEC(k));
    j.arm();
    const out = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys, dryRun: true, http: j.http, env: ENV, sleep });
    assert.deepEqual(j.writes, [], 'no POST/PUT/transition');
    assert.equal(out.results.length, 3);
    for (const r of out.results) {
      assert.equal(r.error, undefined, r.error);
      assert.equal(r.dry_run, true);
      assert.deepEqual(r.labels, ['spec-v1']);
      assert.deepEqual(r.moved, { stage: 'ready', planned: true, from: 'Em grooming', state: 'Pronto para desenvolvimento' });
      assert.equal(j.issues.get(r.key).fields.status.name, 'Em grooming', 'the card did not move');
      assert.deepEqual(j.issues.get(r.key).fields.labels, [], 'no spec-v1 label');
    }
    // a reader session may simulate too (it only reads)
    const reader = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], dryRun: true, http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' }, sleep });
    assert.equal(reader.results[0].dry_run, true);
    // alm.dry_run in the config is a dry run as well
    const cfgDry = project({ dry_run: true });
    j.disarm();
    await op.runtimeAlmRefine(cfgDry, null, { action: 'collect', keys: ['OXE-21'], http: j.http, env: ENV, sleep });
    write(cfgDry, '.oxe/alm/specs/OXE-21.md', TASK_SPEC('OXE-21'));
    j.arm();
    const viaCfg = await op.runtimeAlmRefine(cfgDry, null, { action: 'apply', keys: ['OXE-21'], http: j.http, env: ENV, sleep });
    assert.equal(viaCfg.results[0].dry_run, true);
    assert.deepEqual(j.writes, []);
    // the real apply still writes, once, and moves the card
    j.disarm();
    const real = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV, sleep });
    assert.equal(real.results[0].applied, true);
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Pronto para desenvolvimento');
  });

  it('refine --claim --dry-run plans the move to Em refinamento and writes nothing', async () => {
    const dir = project();
    const j = fakeJira();
    j.arm();
    const out = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20', 'OXE-21'], claim: true, dryRun: true, http: j.http, env: ENV, sleep });
    assert.deepEqual(j.writes, []);
    for (const r of out.results) assert.deepEqual(r.moved, { stage: 'refinement', planned: true, from: 'Em grooming', state: 'Em refinamento' });
    assert.equal(out.dry_run, true);
  });

  it('intake --dry-run with no credential checks the file offline (a reader session validates before the writer)', async () => {
    const dir = project();
    write(dir, 'card.md', TASK_SPEC('NEW-1'));
    write(dir, 'bad.md', '# x\n\n## Objetivo\n\nalgo\n');
    const ok = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'task', summary: 'uma camada de tokens', from: 'card.md', dryRun: true, env: {} });
    assert.equal(ok.offline, true);
    assert.equal(ok.lint.ok, true, ok.lint.errors.join('; '));
    const bad = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'task', summary: 'uma camada de tokens', from: 'bad.md', dryRun: true, env: {} });
    assert.equal(bad.lint.ok, false);
    await assert.rejects(op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'task', summary: 'uma camada de tokens', from: 'card.md', apply: true, env: {} }), /JIRA_SITE/, 'writing still needs the credentials');
  });

  it('intake and version ensure --dry-run write nothing', async () => {
    const dir = project();
    const j = fakeJira();
    j.arm();
    const intake = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'A lateral pisca no Windows', version: '1.5.2', dryRun: true, http: j.http, env: ENV, sleep });
    assert.ok(intake.planned);
    const v = await op.runtimeAlmAdmin(dir, null, { action: 'version', name: '1.5.3', dryRun: true, http: j.http, env: ENV, sleep });
    assert.equal(v.planned, 'criar');
    assert.deepEqual(j.writes, []);
  });

  it('push, sync, move, comment, link and defect --dry-run write nothing', async () => {
    const dir = project();
    const j = fakeJira();
    // a real push first, so the ledger links US-1/T1 to cards (then every dry run has something it could write)
    const pushed = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep });
    assert.ok(pushed.created.length >= 2, JSON.stringify(pushed));
    const linked = [...alm.links(path.join(dir, '.oxe', 'program')).values()];
    assert.ok(linked.length >= 2);
    j.arm();
    const net = { dryRun: true, http: j.http, env: ENV, sleep };
    const push = await op.runtimeAlm(dir, null, { action: 'push', ...net });
    assert.ok(push);
    await op.runtimeAlm(dir, null, { action: 'sync', ...net });
    const move = await op.runtimeAlm(dir, null, { action: 'move', ref: 'US-1', stage: 'review', ...net });
    assert.ok(move.planned, JSON.stringify(move));
    const comment = await op.runtimeAlm(dir, null, { action: 'comment', ref: 'US-1', text: 'visto', ...net });
    assert.ok(comment.planned, JSON.stringify(comment));
    const before = alm.links(path.join(dir, '.oxe', 'program')).size;
    const link = await op.runtimeAlm(dir, null, { action: 'link', ref: 'US-9', key: 'OXE-22', ...net });
    assert.equal(link.dry_run, true);
    assert.equal(alm.links(path.join(dir, '.oxe', 'program')).size, before, 'the ledger did not change');
    const defect = await op.runtimeAlm(dir, null, { action: 'defect', title: 'não chega offline', origin: 'US-1', ...net });
    assert.ok(defect.planned, JSON.stringify(defect));
    assert.deepEqual(j.writes, [], `writes in a dry run: ${j.writes.join(', ')}`);
  });

  it('grill publish and trace publish write only with --apply (the default only shows)', async () => {
    const dir = project();
    const j = fakeJira();
    const g = (action, o = {}) => op.runtimeGrill(dir, null, { action, card: 'OXE-20', ...o });
    g('start', { type: 'bugfix' });
    g('fact', { branch: 'problem', text: 'o card descreve o defeito', source: 'card' });
    j.arm();
    const pub = await op.runtimeGrooming(dir, null, { action: 'publish', card: 'OXE-20', http: j.http, env: ENV, sleep });
    assert.equal(pub.dry_run, true);
    const tr = await op.runtimeTrace(dir, null, { action: 'publish', http: j.http, env: ENV, sleep });
    assert.equal(tr.dry_run, true);
    assert.deepEqual(j.writes, []);
  });
});

describe('OXB-G13: alm.require_apply — writing needs an explicit --apply', () => {
  it('without --apply every writing command is a simulation; with --apply it writes', async () => {
    const dir = project({ require_apply: true });
    const j = fakeJira();
    j.arm();
    const net = { http: j.http, env: ENV, sleep };
    const pushDry = await op.runtimeAlm(dir, null, { action: 'push', ...net });
    assert.ok(pushDry);
    const claimDry = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], claim: true, ...net });
    assert.equal(claimDry.results[0].moved.planned, true);
    write(dir, '.oxe/alm/specs/OXE-20.md', TASK_SPEC('OXE-20'));
    const applyDry = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], ...net });
    assert.equal(applyDry.results[0].dry_run, true);
    assert.match(applyDry.results[0].why_dry, /--apply/);
    const intakeDry = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'task', summary: 'estudo de carga no Windows', ...net });
    assert.ok(intakeDry.planned);
    assert.deepEqual(j.writes, [], 'nothing written without --apply');
    j.disarm();
    const claim = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], claim: true, apply: true, ...net });
    assert.equal(claim.results[0].moved.state, 'Em refinamento');
    write(dir, '.oxe/alm/specs/OXE-20.md', TASK_SPEC('OXE-20'));
    const applied = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], apply: true, ...net });
    assert.equal(applied.results[0].applied, true);
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Pronto para desenvolvimento');
  });
});

describe('OXB-G17/G18: under require_apply, --apply reaches every writing command; a card key works directly; a card links to its PR', () => {
  it('push, move, comment, link --pr, defect, intake and version ensure write with --apply (and only with it)', async () => {
    const dir = project({ require_apply: true, docs: { repo: 'https://github.com/acme/app', branch: 'main' } });
    const j = fakeJira();
    const remote = [];
    const http = async (method, url, headers, body) => {
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/remotelink$/.exec(new URL(url).pathname);
      if (m && method === 'POST') { j.writes.push(`${method} ${new URL(url).pathname}`); remote.push({ key: m[1], ...body }); return { status: 201, json: { id: 1 } }; }
      return j.http(method, url, headers, body);
    };
    const net = { http, env: ENV, sleep };
    const run = (o) => op.runtimeAlm(dir, null, { ...net, ...o });
    // without --apply: simulations, nothing written
    assert.ok((await run({ action: 'move', ref: 'OXE-20', stage: 'released', comment: 'entregue no #771' })).planned);
    assert.ok((await run({ action: 'comment', ref: 'OXE-21', text: 'falhou no HML' })).planned);
    assert.ok((await run({ action: 'link', ref: 'OXE-20', pr: '771' })).planned);
    assert.deepEqual(j.writes, []);
    // with --apply
    const pushed = await run({ action: 'push', apply: true });
    assert.ok(pushed.created.length >= 2, 'push writes');
    const moved = await run({ action: 'move', ref: 'OXE-20', stage: 'released', comment: 'Entregue no #771', apply: true });
    assert.equal(moved.state, 'Lançado');
    assert.equal(moved.commented, true);
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Lançado');
    const commented = await run({ action: 'comment', ref: 'OXE-21', text: 'falhou no HML (run 43559107032)', apply: true });
    assert.equal(commented.commented, true);
    const linked = await run({ action: 'link', ref: 'OXE-20', pr: '#771', apply: true });
    assert.equal(linked.url, 'https://github.com/acme/app/pull/771');
    assert.equal(remote[0].key, 'OXE-20');
    assert.equal(remote[0].globalId, 'oxe-pr:https://github.com/acme/app/pull/771', 'idempotent link');
    const defect = await run({ action: 'defect', title: 'chave i18n crua na lateral', apply: true });
    assert.equal(defect.created, true);
    const intake = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'thread.sections.unknownWorkspace aparece na lateral', apply: true, ...net });
    assert.equal(intake.created, true);
    const v = await op.runtimeAlmAdmin(dir, null, { action: 'version', name: '1.5.3', apply: true, ...net });
    assert.equal(v.created, true);
  });

  it('a key of another project, or an OXE ref outside the ledger, is never taken as a card', async () => {
    const dir = project({ require_apply: true });
    const j = fakeJira();
    const run = (o) => op.runtimeAlm(dir, null, { http: j.http, env: ENV, sleep, apply: true, ...o });
    await assert.rejects(run({ action: 'move', ref: 'US-1', stage: 'review' }), /sem item no ALM/);
    await assert.rejects(run({ action: 'comment', ref: 'ABC-3', text: 'x y' }), /sem item no ALM/);
    await assert.rejects(run({ action: 'link', ref: 'OXE-20', pr: '771' }), /repositório do PR não está configurado/);
    assert.deepEqual(j.writes, []);
  });
});

describe('the umbrella card: alm label --add and alm link --relates, by key, idempotent (OxeSpace 14/11, OXE-22/23)', () => {
  it('a simulation without --apply; with it the label and the Relates links are written once', async () => {
    const dir = project({ require_apply: true });
    const j = fakeJira();
    const net = { http: j.http, env: ENV, sleep };
    j.arm();
    assert.ok((await op.runtimeAlm(dir, null, { action: 'label', ref: 'OXE-22', add: 'guarda-chuva', ...net })).planned);
    assert.ok((await op.runtimeAlm(dir, null, { action: 'link', ref: 'OXE-22', relates: 'OXE-20,OXE-21', ...net })).planned);
    assert.deepEqual(j.writes, []);
    j.disarm();
    const l1 = await op.runtimeAlm(dir, null, { action: 'label', ref: 'OXE-22', add: 'guarda-chuva', apply: true, ...net });
    assert.deepEqual(l1.added, ['guarda-chuva']);
    assert.deepEqual(j.issues.get('OXE-22').fields.labels, ['guarda-chuva']);
    const l2 = await op.runtimeAlm(dir, null, { action: 'label', ref: 'OXE-22', add: 'guarda-chuva', apply: true, ...net });
    assert.deepEqual([l2.added, l2.existed], [[], ['guarda-chuva']], 'not repeated');
    const r1 = await op.runtimeAlm(dir, null, { action: 'link', ref: 'OXE-22', relates: 'OXE-20,OXE-21', apply: true, ...net });
    assert.deepEqual(r1.linked, ['OXE-20', 'OXE-21']);
    assert.equal(j.writes.filter((w) => w === 'POST /rest/api/3/issueLink').length, 2);
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'label', ref: 'OXE-22', add: 'com espaco nao', apply: true, ...net }), /não tem espaço/);
  });

  it('alm version <KEY> <versão>: a simulation without --apply; with it the fix version changes once, with the comment (OXE-10 → 1.5.3)', async () => {
    const dir = project({ require_apply: true });
    const j = fakeJira();
    const net = { http: j.http, env: ENV, sleep };
    j.versions.push({ id: '3', name: '1.5.3', released: false });
    j.issues.get('OXE-20').fields.fixVersions = [{ id: '1', name: '1.5.2' }];
    j.arm();
    assert.ok((await op.runtimeAlm(dir, null, { action: 'version', ref: 'OXE-20', version: '1.5.3', comment: 'adiado para a 1.5.3', ...net })).planned);
    assert.deepEqual(j.writes, []);
    j.disarm();
    const v = await op.runtimeAlm(dir, null, { action: 'version', ref: 'OXE-20', version: '1.5.3', comment: 'adiado para a 1.5.3', apply: true, ...net });
    assert.equal(v.ok, true);
    assert.deepEqual(v.before, ['1.5.2']);
    assert.deepEqual(j.issues.get('OXE-20').fields.fixVersions.map((x) => x.name), ['1.5.3']);
    assert.equal(j.issues.get('OXE-20').fields.comment.comments.length, 1);
    const again = await op.runtimeAlm(dir, null, { action: 'version', ref: 'OXE-20', version: '1.5.3', apply: true, ...net });
    assert.equal(again.changed, false, 'already that version: nothing written');
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'version', ref: 'OXE-20', version: '9.9.9', apply: true, ...net }), /versão 9\.9\.9 não existe/);
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'version', ref: 'OXE-20', version: '1.5.3', apply: true, http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' }, sleep }), /escritor|writer/i);
  });

  it('alm.ref_label "plain": the intake label is ref-<id> (the board convention); the default keeps the program', async () => {
    const plain = project({ ref_label: 'plain' });
    const p = await op.runtimeAlmAdmin(plain, null, { action: 'intake', type: 'task', summary: 'uma camada de tokens', ref: 'TOKENS-1-CAMADA', dryRun: true, env: ENV, http: fakeJira().http, sleep });
    assert.ok(p.planned.labels.includes('ref-TOKENS-1-CAMADA'), p.planned.labels.join(','));
    const def = await op.runtimeAlmAdmin(project(), null, { action: 'intake', type: 'task', summary: 'uma camada de tokens', ref: 'TOKENS-1-CAMADA', dryRun: true, env: ENV, http: fakeJira().http, sleep });
    assert.ok(def.planned.labels.includes('ref-p-TOKENS-1-CAMADA'));
  });
});

describe('G20: an author exempt only for its own paths (the CI bot re-recording goldens), never for any path', () => {
  it('origin.exempt.authored', () => {
    const origin = require('../bin/lib/oxe-origin.cjs');
    const cfg = origin.originConfig({ origin: { exempt: { authored: [{ author: 'github-actions[bot]', paths: ['mobile/android/app/src/test/snapshots/'] }] } } });
    const bot = { name: 'github-actions[bot]' };
    const c = (files, author = bot) => ({ sha: 'abc1234567', parents: 1, author, message: 'chore: record goldens', files });
    assert.equal(origin.classify(c(['mobile/android/app/src/test/snapshots/a.png']), cfg).ok, true);
    assert.equal(origin.classify(c(['mobile/android/app/src/test/snapshots/a.png', 'src/x.ts']), cfg).ok, false, 'a file outside its paths');
    assert.equal(origin.classify(c(['mobile/android/app/src/test/snapshots/a.png'], { name: 'Dev' }), cfg).ok, false, 'another author');
  });
});

describe('deprecation: a write without --apply warns (require_apply becomes the default in the next minor)', () => {
  it('warns once on stderr when it writes without --apply; never with --apply, in a dry run or with require_apply', () => {
    const fresh = () => { delete require.cache[require.resolve('../bin/lib/oxe-alm.cjs')]; return require('../bin/lib/oxe-alm.cjs'); };
    const cfgOf = (l, extra = {}) => l.almConfig({ alm: { provider: 'jira', jira: { project: 'OXE' }, ...extra } });
    const orig = process.stderr.write;
    const lines = [];
    process.stderr.write = (s) => { lines.push(String(s)); return true; };
    try {
      let l = fresh();
      assert.equal(l.warnApply(cfgOf(l), { apply: true }), false);
      assert.equal(l.warnApply(cfgOf(l), { dryRun: true }), false);
      assert.equal(l.warnApply(cfgOf(l, { require_apply: true }), {}), false);
      assert.equal(l.warnApply(cfgOf(l), {}), true);
      assert.equal(l.warnApply(cfgOf(l), {}), false, 'once per process');
      l = fresh();
    } finally { process.stderr.write = orig; }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /próxima versão vai exigir --apply/);
  });
});

describe('OXB-G14: --claim moves the card to Em refinamento, and is never silent', () => {
  it('the writer moves each card from Em grooming to Em refinamento and gets the move back', async () => {
    const dir = project();
    const j = fakeJira();
    const out = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20', 'OXE-21', 'OXE-22'], claim: true, http: j.http, env: ENV, sleep });
    for (const r of out.results) {
      assert.equal(r.moved.state, 'Em refinamento', JSON.stringify(r.moved));
      assert.equal(r.moved.changed, true);
      assert.equal(j.issues.get(r.key).fields.status.name, 'Em refinamento');
    }
    assert.equal(out.dry_run, false, 'the claim wrote: the CLI must not say "só leitura"');
    // claimed again: already there, no second transition
    const again = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], claim: true, http: j.http, env: ENV, sleep });
    assert.equal(again.results[0].moved.changed, false);
  });

  it('a reader session, an unmapped stage or a card already Pronto says why it did not move', async () => {
    const j = fakeJira();
    const reader = await op.runtimeAlmRefine(project(), null, { action: 'collect', keys: ['OXE-20'], claim: true, http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' }, sleep });
    assert.equal(reader.results[0].moved.skipped, true);
    assert.match(reader.results[0].moved.why, /só leitura/);
    const untracked = await op.runtimeAlmRefine(project({ track: ['grooming', 'ready'] }), null, { action: 'collect', keys: ['OXE-20'], claim: true, http: j.http, env: ENV, sleep });
    assert.match(untracked.results[0].moved.why, /fora de alm\.track/);
    j.issues.get('OXE-21').fields.status = { name: 'Pronto para desenvolvimento' };
    const ready = await op.runtimeAlmRefine(project(), null, { action: 'collect', keys: ['OXE-21'], claim: true, http: j.http, env: ENV, sleep });
    assert.equal(ready.results[0].moved.skipped, true);
    assert.equal(j.issues.get('OXE-21').fields.status.name, 'Pronto para desenvolvimento', 'never moved back');
  });
});

describe('OXB-G16: the lint reads what goes to the card, not the original text kept in an HTML comment', () => {
  it('a card whose original description is a skeleton full of "A confirmar" does not fail the refined spec', () => {
    const refine = require('../bin/lib/oxe-alm-refine.cjs');
    const original = '<!-- Texto original do card (não vai para a descrição; vira comentário no apply) -->\n<!--\n## Resumo\nx\n\n## Fora de escopo\n- A confirmar\n\n## Causa\nDesconhecida (A confirmar)\n-->\n';
    const md = `${TASK_SPEC('OXE-135')}\n${original}`;
    const l = refine.lintSpec(md, 'task');
    assert.equal(l.ok, true, l.errors.join('; '));
    assert.equal(l.needs_info, false);
    assert.doesNotMatch(refine.descriptionBody(md), /A confirmar/);
  });
});

describe('OXB-G12: the grooming comment keeps facts apart from questions', () => {
  it('facts under "Fatos (fonte)" with their source; answered questions with answer and source; none "em aberto"', () => {
    const { renderComment } = require('../bin/lib/oxe-grooming.cjs');
    const qs = [
      { id: 'Q-1', branch: 'problem', question: 'a lateral fica branca', answer: 'a lateral fica branca 94 ms a frio', decided_by: 'code', status: 'decided', source: 'card' },
      { id: 'Q-2', branch: 'scope', question: 'fato 2', answer: 'só a lateral', decided_by: 'code', status: 'decided', source: 'criterios-1-5-2-onda1.md' },
      { id: 'Q-3', branch: 'nfr', question: 'Qual é a meta?', recommended: '≤ 40 ms', answer: '≤ 40 ms', decided_by: 'recommended', status: 'decided', answer_source: 'coordenação: medição do #788' },
    ];
    const text = renderComment('OXE-58', { questions: qs });
    assert.match(text, /^Fatos \(fonte\): 2/m);
    assert.match(text, /- a lateral fica branca 94 ms a frio — fonte: card/);
    assert.match(text, /^Perguntas: 1 \(1 respondida\(s\), 0 em aberto\)/m);
    assert.match(text, /- Resposta: ≤ 40 ms \[coordenação: medição do #788\]/);
    assert.doesNotMatch(text, /OXE-58\/Q-1|OXE-58\/Q-2/, 'a fact is never listed as a question');
    assert.doesNotMatch(text, /Aguardando resposta/);
    assert.match(text, /Todas respondidas/);
    // the batch-1 shape: 18 questions + 35 facts → "Perguntas: 18", never 53
    const many = [...Array.from({ length: 35 }, (_, i) => ({ id: `F-${i}`, branch: 'problem', answer: `fato ${i}`, decided_by: 'code', status: 'decided', source: 'card' })), ...Array.from({ length: 18 }, (_, i) => ({ id: `Q-${i}`, branch: 'scope', question: `pergunta ${i}?`, recommended: 'r', answer: 'r', decided_by: 'recommended', status: 'decided', answer_source: 'coordenação' }))];
    // "card defasado em relação ao código": a fact marked --stale (the card asks for what the code already does)
    const dir = project();
    const g = (action, o = {}) => op.runtimeGrill(dir, null, { action, card: 'OXE-11', ...o });
    g('start', { type: 'bugfix' });
    const f = g('fact', { branch: 'scope', text: 'corrigido no #771, já na main', source: 'src/x.ts:46' });
    const q = g('ask', { branch: 'rollout', question: 'fecha só pelo código?', recommended: 'não' });
    assert.throws(() => g('mark', { id: q.id, stale: true }), /só um fato/);
    g('mark', { id: f.id, stale: true });
    const st = require('../bin/lib/oxe-grill.cjs').status(path.join(dir, '.oxe', 'alm', 'grill', 'OXE-11'));
    const c = renderComment('OXE-11', st);
    assert.match(c, /- \[card defasado\] corrigido no #771/);
    const { report } = require('../bin/lib/oxe-grooming.cjs');
    const rep = report([{ key: 'OXE-11', status: st, criteria: null, lint: null }]);
    assert.equal(rep.rows[0].stale_vs_code, true);
    assert.equal(rep.total.stale, 1);
    // grill depth: a fact the grooming missed, found at planning (OXE-107: the cause found by the F3 planner)
    const late = g('fact', { branch: 'problem', text: 'local-rpc-server.ts:145 monta o contexto sem androidAccess', source: 'planejamento F3' });
    g('mark', { id: late.id, late: 'planejamento' });
    const st2 = require('../bin/lib/oxe-grill.cjs').status(path.join(dir, '.oxe', 'alm', 'grill', 'OXE-11'));
    const rep2 = report([{ key: 'OXE-11', status: st2, criteria: null, lint: null }]);
    assert.deepEqual(rep2.rows[0].found_late, ['planejamento']);
    assert.equal(rep2.total.found_late, 1);
    assert.match(require('../bin/lib/oxe-grooming.cjs').renderReport(rep2), /Profundidade do grill[^\n]*OXE-11: no planejamento/);
    const big = renderComment('X-1', { questions: many });
    assert.match(big, /^Fatos \(fonte\): 35/m);
    assert.match(big, /^Perguntas: 18 \(18 respondida\(s\), 0 em aberto\)/m);
  });
});

describe('G21: a reader session records the card writes as pending requests; the writer drains them once', () => {
  it('quick start as a reader writes nothing and records the comment and the move; alm pending apply applies them', async () => {
    const dir = project();
    const j = fakeJira();
    const reader = { ...ENV, OXE_ALM_WRITER: 'outra-sessao' };
    j.arm();
    const q = await op.runtimeQuick(dir, null, { action: 'start', key: 'OXE-20', objective: 'ajuste do rótulo do menu', http: j.http, env: reader, sleep });
    assert.deepEqual(j.writes, [], 'a reader never writes the card');
    assert.deepEqual(q.alm.pending.map((p) => p.op), ['comment', 'move']);
    assert.match(q.alm.why, /alm pending apply/);
    j.disarm();
    const list = await op.runtimeAlm(dir, null, { action: 'pending', http: j.http, env: reader, sleep });
    assert.equal(list.pending.length, 2);
    // a reader cannot apply
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'pending', sub: 'apply', http: j.http, env: reader, sleep }), /escritor|writer/i);
    const net = { http: j.http, env: ENV, sleep };
    const applied = await op.runtimeAlm(dir, null, { action: 'pending', sub: 'apply', ...net });
    assert.equal(applied.applied.length, 2, JSON.stringify(applied.failed));
    assert.equal(applied.remaining, 0);
    assert.equal(j.issues.get('OXE-20').fields.comment.comments.length, 1);
    assert.equal(j.issues.get('OXE-20').fields.status.name, STATES.in_progress);
    const again = await op.runtimeAlm(dir, null, { action: 'pending', sub: 'apply', ...net });
    assert.equal(again.applied.length, 0, 'never applied twice');
  });
});

describe('alm summary <KEY> "<título>": the card title after a refine narrowed the scope (OxeSpace 14/11, OXE-160)', () => {
  it('a simulation without --apply; with it the summary changes; a reader is refused', async () => {
    const dir = project({ require_apply: true });
    const j = fakeJira();
    const net = { http: j.http, env: ENV, sleep };
    j.arm();
    assert.ok((await op.runtimeAlm(dir, null, { action: 'summary', ref: 'OXE-20', summary: 'Menu ⋯ com 8 itens, sem o diálogo', ...net })).planned);
    assert.deepEqual(j.writes, []);
    j.disarm();
    const s = await op.runtimeAlm(dir, null, { action: 'summary', ref: 'OXE-20', summary: 'Menu ⋯ com 8 itens, sem o diálogo', apply: true, ...net });
    assert.equal(s.ok, true);
    assert.equal(j.issues.get('OXE-20').fields.summary, 'Menu ⋯ com 8 itens, sem o diálogo');
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'summary', ref: 'OXE-20', summary: 'outro título', apply: true, http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' }, sleep }), /escritor|writer/i);
  });
});

describe('alm supersede <OLD> --by <NEW>: link, comment and close the old card as superseded (OxeSpace 15/11, OxeChat redo)', () => {
  function supersedeJira() {
    const j = fakeJira();
    const links = [];
    let posted = null;
    const base = j.http;
    j.http = async (method, url, headers, body) => {
      const p = new URL(url).pathname;
      if (method === 'GET' && p === '/rest/api/3/issueLinkType') return { status: 200, json: { issueLinkTypes: [{ name: 'Relates', inward: 'relates to', outward: 'relates to' }, { name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' }] } };
      let m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
      if (m && method === 'GET' && new URL(url).searchParams.get('fields') === 'issuelinks,status') {
        const it = j.issues.get(m[1]);
        return { status: 200, json: { key: m[1], fields: { status: { name: it.fields.status.name, statusCategory: { key: /Cancelado/.test(it.fields.status.name) ? 'done' : 'indeterminate' } }, issuelinks: links.filter((l) => l.inwardIssue.key === m[1] || l.outwardIssue.key === m[1]).map((l) => (l.inwardIssue.key === m[1] ? { outwardIssue: l.outwardIssue } : { inwardIssue: l.inwardIssue })) } } };
      }
      m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(p);
      if (m && method === 'GET' && /expand=transitions\.fields/.test(url)) return { status: 200, json: { transitions: [{ id: '9', name: 'Cancelar', to: { name: 'Cancelado', statusCategory: { key: 'done' } }, fields: { resolution: { required: true, allowedValues: [{ name: 'Done' }, { name: "Won't Do" }] } } }, { id: '2', name: 'Em desenvolvimento', to: { name: 'Em desenvolvimento', statusCategory: { key: 'indeterminate' } } }] } };
      if (m && method === 'POST' && body && body.transition && body.transition.id === '9') { posted = body; j.issues.get(m[1]).fields.status = { name: 'Cancelado' }; return { status: 204, json: null }; }
      if (method === 'POST' && p === '/rest/api/3/issueLink') { links.push(body); }
      return base(method, url, headers, body);
    };
    return { j, links, posted: () => posted };
  }

  it('a dry run only reads and says what it would do; --apply links (Duplicate), comments and closes with Won\'t Do, once', async () => {
    const dir = project({ require_apply: true });
    const { j, links, posted } = supersedeJira();
    const net = { http: j.http, env: ENV, sleep };
    j.arm();
    const dry = await op.runtimeAlm(dir, null, { action: 'supersede', ref: 'OXE-20', newKeys: 'OXE-21,OXE-22', ...net });
    assert.deepEqual(j.writes, [], 'a dry run never writes');
    assert.equal(dry.planned.link_type, 'Duplicate');
    assert.deepEqual(dry.planned.links, ['OXE-21', 'OXE-22']);
    assert.equal(dry.planned.close.transition, 'Cancelar');
    assert.equal(dry.planned.close.resolution, "Won't Do");
    j.disarm();
    const out = await op.runtimeAlm(dir, null, { action: 'supersede', ref: 'OXE-20', newKeys: 'OXE-21,OXE-22', comment: 'Refeito na 1.5.2: OXE-21 e OXE-22.', apply: true, ...net });
    assert.equal(out.applied, true);
    assert.equal(out.status, 'Cancelado');
    assert.equal(links.length, 2);
    assert.equal(links[0].outwardIssue.key, 'OXE-20', 'Duplicate: the old card duplicates the new one');
    assert.deepEqual(posted().fields, { resolution: { name: "Won't Do" } });
    assert.equal(j.issues.get('OXE-20').fields.comment.comments.length, 1);
    const again = await op.runtimeAlm(dir, null, { action: 'supersede', ref: 'OXE-20', newKeys: 'OXE-21,OXE-22', apply: true, ...net });
    assert.deepEqual(again.links, [], 'links not repeated');
    assert.equal(again.close.skipped, true, 'already done: not moved');
    assert.equal(again.unchanged, true);
    assert.equal(j.issues.get('OXE-20').fields.comment.comments.length, 1, 'no second comment');
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'supersede', ref: 'OXE-20', newKeys: 'OXE-20', apply: true, ...net }), /não substitui a si mesmo/);
  });
});
