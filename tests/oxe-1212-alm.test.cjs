'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — ALM end to end against FAKE providers (no network): PRD stories and plan tasks become items idempotently,
// the lifecycle moves them by state NAME, a failure never fails the OXE command, and nothing is written in a dry run.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token' };
const STATES = { in_progress: 'Em andamento', in_review: 'Em revisão', queued: 'Na fila', merged: 'Na main', released: 'Lançado' };

/** In-memory Jira: search by label, create, read, transitions by name, comments, links, versions. */
function fakeJira(options = {}) {
  const issues = new Map();
  const calls = [];
  let n = options.start || 100;
  let failNext = options.failFirst || 0;
  const statuses = ['A fazer', ...Object.values(STATES)];
  const versions = [{ id: '1', name: '1.5.2', released: false }];
  for (const seed of options.seed || []) issues.set(seed.key, { key: seed.key, id: seed.key.replace(/\D/g, ''), fields: { summary: seed.summary || 'x', labels: seed.labels || [], status: { name: seed.status || 'A fazer' } } });
  const http = async (method, url, headers, body) => {
    calls.push({ method, url, body, auth: headers.Authorization });
    if (failNext > 0) { failNext -= 1; return { status: 503, json: null, text: 'unavailable', headers: {} }; }
    const u = new URL(url);
    const p = u.pathname;
    if (method === 'GET' && p === '/rest/api/3/search/jql') {
      const label = /labels = "([^"]+)"/.exec(u.searchParams.get('jql'))[1];
      return { status: 200, json: { issues: [...issues.values()].filter((i) => i.fields.labels.includes(label)).map((i) => ({ key: i.key, id: i.id, fields: { status: i.fields.status } })) } };
    }
    if (method === 'POST' && p === '/rest/api/3/issue') {
      n += 1;
      const key = `OXE-${n}`;
      issues.set(key, { key, id: String(n), fields: { ...body.fields, status: { name: 'A fazer' } } });
      return { status: 201, json: { key, id: String(n) } };
    }
    let m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
    if (method === 'GET' && m) return issues.has(m[1]) ? { status: 200, json: issues.get(m[1]) } : { status: 404, json: null, text: 'not found' };
    m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(p);
    if (m && method === 'GET') return { status: 200, json: { transitions: statuses.map((s, i) => ({ id: String(11 + i * 10), name: s, to: { name: s } })) } };
    if (m && method === 'POST') { const s = statuses[(Number(body.transition.id) - 11) / 10]; issues.get(m[1]).fields.status = { name: s }; return { status: 204, json: null }; }
    m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/.exec(p);
    if (m && method === 'POST') { (issues.get(m[1]).comments = issues.get(m[1]).comments || []).push(body.body); return { status: 201, json: {} }; }
    if (method === 'POST' && p === '/rest/api/3/issueLink') { (issues.get(body.inwardIssue.key).links = issues.get(body.inwardIssue.key).links || []).push({ type: body.type.name, to: body.outwardIssue.key }); return { status: 201, json: null }; }
    if (method === 'GET' && /\/project\/[A-Z]+\/versions$/.test(p)) return { status: 200, json: versions };
    m = /^\/rest\/api\/3\/version\/(\d+)$/.exec(p);
    if (m && method === 'PUT') { Object.assign(versions.find((v) => v.id === m[1]), body); return { status: 200, json: {} }; }
    return { status: 404, json: null, text: `no route ${method} ${p}` };
  };
  return { http, issues, calls, versions };
}

const PRD = [
  '---', 'oxe_doc: prd', 'version: 1', '---', '', '# PRD — Envio para o celular', '',
  '## Histórias de usuário', '',
  '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
  '|----|------|-------|------|------------|-----------|------------|',
  '| US-1 | operador | enviar texto ao celular | não digitar duas vezes | R1 | A1 | Must |',
  '| US-2 | operador | ver o status do envio | saber se chegou | R2 | A2 | Should |', '',
].join('\n');

function project(almBlock, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-alm-'));
  dirs.push(dir);
  write(dir, '.oxe/config.json', JSON.stringify({ alm: almBlock, docs_publish: false, adr: false }));
  write(dir, '.oxe/PRD.md', PRD);
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [
    { id: 'T1', title: 'enviar texto', acceptance: ['A1'], files: ['src/send.ts'], labels: ['area-celular'] },
    { id: 'T2', title: 'status do envio (CODE-8)', acceptance: ['A2'], files: ['src/status.ts'] },
    { id: 'T3', title: 'feito', done: true, acceptance: ['A1'] },
  ], ...extra }, null, 2));
  return dir;
}

const JIRA = { provider: 'jira', program: '152code', jira: { project: 'OXE' }, epic: 'OXE-4', labels: ['area-oxe'], fix_version: { F1: '1.5.2' }, states: STATES, adopt_prefixes: ['CODE'] };

describe('ALM: config', () => {
  it('none / absent → no ALM; missing env vars are named, never their values', () => {
    assert.equal(alm.almConfig({}), null);
    assert.equal(alm.almConfig({ alm: { provider: 'none' } }), null);
    const cfg = alm.almConfig({ alm: JIRA });
    assert.deepEqual(alm.checkConfig(cfg, {}), ['variável de ambiente JIRA_SITE não definida', 'variável de ambiente JIRA_EMAIL não definida', 'variável de ambiente JIRA_API_TOKEN não definida']);
    assert.deepEqual(alm.checkConfig(cfg, ENV), []);
    assert.equal(cfg.program, '152code');
    assert.deepEqual(cfg.track, alm.STAGES, 'track defaults to every stage');
    assert.throws(() => alm.almConfig({ alm: { provider: 'trello' } }), /desconhecido/);
  });

  it('the idempotency label is ref-<program>-<ref>, never oxe-…', () => {
    assert.equal(alm.refLabel('F2-T5', { program: '152code' }), 'ref-152code-F2-T5');
    assert.deepEqual(alm.oldRefs({ adopt_prefixes: ['CODE', 'VIS'] }, { title: 'conserta CODE-8 e VIS-04', refs: ['BRD-2'] }).sort(), ['BRD-2', 'CODE-8', 'VIS-04']);
  });
});

describe('ALM: push', () => {
  it('epic given → stories + pending tasks, with the version of the phase, labels added; rerun creates nothing', async () => {
    const dir = project(JIRA);
    write(dir, '.oxe/program/PROGRAM.json', JSON.stringify({ active_phase: 'F1', phases: [{ id: 'F1', status: 'executing', acceptance: ['A1', 'A2'] }] }));
    const j = fakeJira();
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} });
    assert.deepEqual(out.created.map((c) => c.ref), ['US-1', 'US-2', 'F1-T1', 'F1-T2']);
    const t1 = [...j.issues.values()].find((i) => i.fields.labels.includes('ref-152code-F1-T1'));
    assert.deepEqual(t1.fields.labels.sort(), ['area-celular', 'area-oxe', 'ref-152code-F1-T1']);
    assert.equal(t1.fields.parent.key, 'OXE-4');
    assert.deepEqual(t1.fields.fixVersions, [{ name: '1.5.2' }]);
    assert.equal(t1.fields.issuetype.name, 'Task');
    assert.ok(t1.links.some((l) => l.type === 'Relates'), 'the task is linked to its story');
    assert.match(JSON.stringify(j.issues.get('OXE-101').fields.description), /Como operador, quero enviar texto ao celular/);
    assert.ok(j.calls.every((c) => c.auth === `Basic ${Buffer.from('bot@example.com:secret-token').toString('base64')}`));
    const again = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(again.created.length, 0);
    assert.equal(j.issues.size, 4);
    assert.ok(!fs.readFileSync(path.join(dir, '.oxe', 'PLAN.json'), 'utf8').includes('OXE-1'), 'the key never goes into PLAN.json');
  });

  it('adoption: a task carrying CODE-8 links to the item labeled ref-CODE-8 instead of creating one', async () => {
    const dir = project(JIRA);
    const j = fakeJira({ seed: [{ key: 'OXE-9', labels: ['ref-CODE-8'], status: 'Em andamento' }] });
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {}, stories: false });
    const t2 = out.reused.find((r) => r.ref === 'F1-T2');
    assert.equal(t2.key, 'OXE-9');
    assert.equal(t2.adopted, 'CODE-8');
    assert.equal(alm.links(path.join(dir, '.oxe', 'program')).get('F1-T2').key, 'OXE-9');
  });

  it('dry run: reads (what exists) but never writes — not in the ALM, not in the local ledger', async () => {
    const dir = project(JIRA);
    const j = fakeJira({ seed: [{ key: 'OXE-50', labels: ['ref-152code-US-1'] }] });
    const out = await op.runtimeAlm(dir, null, { action: 'push', dryRun: true, http: j.http, env: ENV, sleep: async () => {} });
    assert.ok(j.calls.every((c) => c.method === 'GET'), 'only reads');
    assert.deepEqual(out.reused.map((r) => r.key), ['OXE-50']);
    assert.deepEqual(out.planned.map((p) => p.ref), ['US-2', 'F1-T1', 'F1-T2']);
    assert.equal(fs.existsSync(path.join(dir, '.oxe', 'program', 'alm-links.ndjson')), false);
    // without credentials the dry run sends nothing at all
    const k = fakeJira();
    await op.runtimeAlm(dir, null, { action: 'push', dryRun: true, http: k.http, env: {}, sleep: async () => {} });
    assert.equal(k.calls.length, 0);
  });

  it('the epic is created from the PRD title when the config names none', async () => {
    const dir = project({ ...JIRA, epic: undefined });
    const j = fakeJira();
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {}, tasks: false });
    assert.equal(out.created[0].ref, 'EPIC');
    const epic = j.issues.get(out.created[0].key);
    assert.equal(epic.fields.issuetype.name, 'Epic');
    assert.equal(epic.fields.summary, 'Envio para o celular');
    assert.equal(j.issues.get(out.created[1].key).fields.parent.key, out.created[0].key);
  });
});

describe('ALM: the label search lags behind a create (measured on Jira Cloud)', () => {
  it('the local record wins; with it lost, a second spaced search finds the item and nothing is duplicated', async () => {
    const dir = project(JIRA);
    const j = fakeJira();
    await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {}, stories: false });
    assert.equal(j.issues.size, 2);
    // the record is lost (a new worktree) and the search does not see the items on the first look
    fs.rmSync(path.join(dir, '.oxe', 'program', 'alm-links.ndjson'));
    let searches = 0;
    const lagging = async (method, url, h, body) => {
      if (method === 'GET' && /search\/jql/.test(url) && (searches += 1) === 1) return { status: 200, json: { issues: [] } };
      return j.http(method, url, h, body);
    };
    const waits = [];
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: lagging, env: ENV, sleep: async (ms) => { waits.push(ms); }, stories: false });
    assert.equal(out.created.length, 0, 'no duplicate');
    assert.equal(j.issues.size, 2);
    assert.deepEqual(waits, [5000], 'one spaced wait per push');
  });

  it('ledger_guard: no record → refuse to create; --rebuild-ledger records what the search finds and creates nothing', async () => {
    const block = { ...JIRA, ledger_guard: true };
    const dir = project(block);
    assert.equal(alm.almConfig({ alm: block }).search_settle_ms, 60000, 'guard → 60 s settle by default');
    const j = fakeJira({ seed: [{ key: 'OXE-77', labels: ['ref-152code-F1-T1'] }] });
    const net = { http: j.http, env: ENV, sleep: async () => {}, stories: false };
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'push', ...net }), /registro local do ALM ausente.*--rebuild-ledger/);
    assert.equal(j.issues.size, 1, 'nothing created');
    const rb = await op.runtimeAlm(dir, null, { action: 'push', rebuildLedger: true, ...net });
    assert.deepEqual(rb.reused.map((r) => `${r.ref}=${r.key}`), ['F1-T1=OXE-77']);
    assert.deepEqual(rb.missing.map((m) => m.ref), ['F1-T2']);
    assert.equal(j.issues.size, 1, 'rebuild never creates');
    const after = await op.runtimeAlm(dir, null, { action: 'push', ...net });
    assert.deepEqual(after.created.map((c) => c.ref), ['F1-T2'], 'with the record back, the missing one is created');
    const fresh = project(block);
    const k = fakeJira();
    const first = await op.runtimeAlm(fresh, null, { action: 'push', firstPush: true, http: k.http, env: ENV, sleep: async () => {}, stories: false });
    assert.equal(first.created.length, 2, '--first-push for a program that never pushed');
  });

  it('the key is recorded right after the POST, even when the read-back fails', async () => {
    const dir = project(JIRA);
    const j = fakeJira();
    const flaky = async (method, url, h, body) => (method === 'GET' && /\/issue\/OXE-\d+\?/.test(url) ? { status: 503, json: null, text: 'x', headers: {} } : j.http(method, url, h, body));
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: flaky, env: ENV, sleep: async () => {}, stories: false, retries: 1 });
    assert.ok(out.created.every((c) => c.unconfirmed), 'reported as unconfirmed');
    assert.equal(alm.links(path.join(dir, '.oxe', 'program')).size, 2, 'recorded anyway');
    const again = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {}, stories: false });
    assert.equal(again.created.length, 0);
    assert.equal(j.issues.size, 2);
  });
});

describe('ALM: sync and failures', () => {
  it('events → stages by state NAME; idempotent; comments only on a real change; track limits what the OXE moves', async () => {
    const dir = project(JIRA);
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'F1-T1', key: 'OXE-201' });
    alm.addLink(pdir, { ref: 'F1-T2', key: 'OXE-202' });
    const j = fakeJira({ seed: [{ key: 'OXE-201' }, { key: 'OXE-202' }] });
    const cfg = alm.almConfig({ alm: JIRA });
    const ev = [
      { type: 'TaskStarted', work_item_id: 'T1' },
      { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'https://github.com/o/r/pull/9' } },
      { type: 'TaskStarted', work_item_id: 'T2' },
    ];
    const r = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(j.issues.get('OXE-201').fields.status.name, 'Em revisão');
    assert.equal(j.issues.get('OXE-202').fields.status.name, 'Em andamento');
    assert.match(JSON.stringify(j.issues.get('OXE-201').comments), /PR aberto: https:\/\/github\.com\/o\/r\/pull\/9/);
    assert.equal(r.moved.length, 3);
    const again = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(again.moved.length, 0, 'cursor: the same events are not applied twice');
    // track: ["in_progress"] → a repository action moves PR / train / tag; the OXE does not
    const dir2 = project({ ...JIRA, track: ['in_progress'] });
    const p2 = path.join(dir2, '.oxe', 'program');
    alm.addLink(p2, { ref: 'F1-T1', key: 'OXE-201' });
    const k = fakeJira({ seed: [{ key: 'OXE-201' }] });
    const r2 = await alm.sync(p2, alm.almConfig({ alm: { ...JIRA, track: ['in_progress'] } }), ev.slice(0, 2), { phase: 'F1' }, { http: k.http, env: ENV, sleep: async () => {} });
    assert.equal(k.issues.get('OXE-201').fields.status.name, 'Em andamento');
    assert.ok(r2.skipped.some((s) => s.stage === 'review' && /alm\.track/.test(s.why)));
  });

  it('a network failure is retried with backoff; a lasting one stays pending and goes on the next sync', async () => {
    const dir = project(JIRA);
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'F1-T1', key: 'OXE-201' });
    const j = fakeJira({ seed: [{ key: 'OXE-201' }], failFirst: 2 });
    const waits = [];
    const cfg = alm.almConfig({ alm: JIRA });
    const r = await alm.sync(pdir, cfg, [{ type: 'TaskStarted', work_item_id: 'T1' }], { phase: 'F1' }, { http: j.http, env: ENV, sleep: async (ms) => { waits.push(ms); } });
    assert.equal(r.moved.length, 1, 'two 503 then ok');
    assert.deepEqual(waits, [1000, 3000]);
    const down = fakeJira({ seed: [{ key: 'OXE-201' }], failFirst: 99 });
    const r2 = await alm.sync(pdir, cfg, [{ type: 'TaskStarted', work_item_id: 'T1' }, { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'u' } }], { phase: 'F1' }, { http: down.http, env: ENV, sleep: async () => {} });
    assert.equal(r2.failed.length, 1);
    assert.equal(alm.readState(pdir).pending.length, 1);
    const up = fakeJira({ seed: [{ key: 'OXE-201', status: 'Em andamento' }] });
    const r3 = await alm.sync(pdir, cfg, [{ type: 'TaskStarted', work_item_id: 'T1' }, { type: 'TaskPromoted', work_item_id: 'T1', payload: { pr: 'u' } }], { phase: 'F1' }, { http: up.http, env: ENV, sleep: async () => {} });
    assert.equal(r3.moved[0].stage, 'review', 'the pending write went through');
    assert.equal(alm.readState(pdir).pending.length, 0);
  });

  it('almAutoSync never throws, even with the ALM down or misconfigured', async () => {
    const dir = project({ provider: 'jira', jira: {} });
    assert.equal(op.almAutoSync(dir, null), null, 'misconfigured → silently off');
    const dir2 = project({ provider: 'nope' });
    assert.equal(op.almAutoSync(dir2, null), null);
  });

  it('deploy → released + the version of the phase released (release_version); a defect → bug item Relates to its origin', async () => {
    const dir = project({ ...JIRA, release_version: true });
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'F1-T1', key: 'OXE-201' });
    const j = fakeJira({ seed: [{ key: 'OXE-201', status: 'Na main' }] });
    const cfg = alm.almConfig({ alm: { ...JIRA, release_version: true } });
    const r = await alm.sync(pdir, cfg, [{ type: 'DeployAttached', payload: { phase: 'F1', env: 'prod', ok: true } }], { phase: 'F1', refsOfPhase: () => ['F1-T1'] }, { http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(j.issues.get('OXE-201').fields.status.name, 'Lançado');
    assert.equal(r.version_released, '1.5.2');
    assert.equal(j.versions[0].released, true);
    const d = await alm.reportDefect(pdir, cfg, { ref: 'BUG-1', title: 'envio duplicado', origin: 'F1-T1', phase: 'F1' }, { http: j.http, env: ENV, sleep: async () => {} });
    const bug = j.issues.get(d.key);
    assert.ok(bug.fields.labels.includes('bug'));
    assert.deepEqual(bug.links, [{ type: 'Relates', to: 'OXE-201' }]);
  });
});

describe('ALM: keys in the PR, the commit and the branch', () => {
  it('checkpoint subject and promote title carry the key; without ALM nothing changes', () => {
    const cc = require('../bin/lib/oxe-commit-convention.cjs');
    assert.match(cc.checkpointMessage({ id: 'T1', title: 'enviar texto', phase: 'F1', alm_key: 'OXE-12' }, {}).split('\n')[0], /\(OXE-12\)$/);
    assert.doesNotMatch(cc.checkpointMessage({ id: 'T1', title: 'enviar texto', phase: 'F1' }, {}).split('\n')[0], /OXE-/);
    const dir = project(JIRA);
    alm.addLink(path.join(dir, '.oxe', 'program'), { ref: 'F1-T1', key: 'OXE-12' });
    assert.equal(alm.keyFor(path.join(dir, '.oxe', 'program'), alm.almConfig({ alm: JIRA }), 'F1', 'T1'), 'OXE-12');
    assert.equal(alm.keyFor(path.join(dir, '.oxe', 'program'), alm.almConfig({ alm: { provider: 'azure-devops', azure_devops: { project: 'p' } } }), 'F1', 'T1'), 'AB#OXE-12');
  });
});

describe('ALM: Azure DevOps uses the same interface', () => {
  it('create = JSON Patch with tags + parent relation; transition = System.State; search = WIQL', async () => {
    const calls = [];
    const items = new Map();
    const http = async (method, url, headers, body) => {
      calls.push({ method, url, body, ct: headers['Content-Type'] });
      if (method === 'POST' && /\/wit\/wiql/.test(url)) return { status: 200, json: { workItems: [] } };
      if (method === 'POST' && /\/wit\/workitems\/\$/.test(url)) { const id = 700 + items.size; items.set(String(id), { id, fields: { 'System.State': 'New' }, ops: body }); return { status: 200, json: { id } }; }
      const m = /\/wit\/workitems\/(\d+)/.exec(url);
      if (m && method === 'GET') return { status: 200, json: items.get(m[1]) };
      if (m && method === 'PATCH') { items.get(m[1]).fields['System.State'] = body[0].value; return { status: 200, json: {} }; }
      return { status: 404, json: null, text: url };
    };
    const cfg = alm.almConfig({ alm: { provider: 'azure-devops', program: 'p1', azure_devops: { project: 'Proj', area_path: 'Proj\\Mobile' }, states: { in_progress: 'Active' } } });
    const env = { AZURE_DEVOPS_ORG: 'myorg', AZURE_DEVOPS_EXT_PAT: 'pat' };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-ado-'));
    dirs.push(dir);
    const out = await alm.push(dir, cfg, { stories: [{ id: 'US-1', persona: 'a', want: 'b', benefit: 'c', criteria: ['A1'], requirements: [] }], tasks: [{ id: 'T1', title: 't', acceptance: ['A1'] }], phase: 'F1' }, { http, env, sleep: async () => {} });
    assert.deepEqual(out.created.map((c) => c.key), ['700', '701']);
    const create = calls.find((c) => /\$User%20Story/.test(c.url));
    assert.equal(create.ct, 'application/json-patch+json');
    assert.ok(create.body.some((o) => o.path === '/fields/System.Tags' && /ref-p1-US-1/.test(o.value)));
    assert.ok(create.body.some((o) => o.path === '/fields/System.AreaPath'));
    const task = calls.find((c) => /\$Task/.test(c.url));
    assert.ok(task.body.some((o) => o.path === '/relations/-' && /workItems\/700$/.test(o.value.url)), 'Task under its User Story');
    const r = await alm.sync(dir, cfg, [{ type: 'TaskStarted', work_item_id: 'T1' }], { phase: 'F1' }, { http, env, sleep: async () => {} });
    assert.equal(r.moved[0].state, 'Active');
  });
});
