'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — from the ALM coordination (13–14/11): one writer per program (two sessions created the same BRD batch:
// 19 duplicates), a local write lock, comments open to reader sessions, and the fix version set by id through
// `update.fixVersions[].set` (a PUT of fields.fixVersions came back empty).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token' };

function fakeJira(options = {}) {
  const issues = new Map();
  const calls = [];
  let n = 200;
  const versions = [{ id: '10042', name: '1.5.2', released: false }];
  for (const s of options.seed || []) issues.set(s.key, { key: s.key, id: s.key.replace(/\D/g, ''), fields: { summary: 'x', labels: s.labels || [], status: { name: 'A fazer' }, fixVersions: s.fixVersions || [] } });
  const http = async (method, url, headers, body) => {
    calls.push({ method, url, body });
    const u = new URL(url);
    const p = u.pathname;
    if (method === 'GET' && p === '/rest/api/3/search/jql') {
      const label = /labels = "([^"]+)"/.exec(u.searchParams.get('jql'))[1];
      return { status: 200, json: { issues: [...issues.values()].filter((i) => i.fields.labels.includes(label)).map((i) => ({ key: i.key, id: i.id, fields: { status: i.fields.status } })) } };
    }
    if (method === 'POST' && p === '/rest/api/3/issue') {
      n += 1;
      const key = `OXE-${n}`;
      // like the incident: the create ignores fixVersions
      issues.set(key, { key, id: String(n), fields: { ...body.fields, fixVersions: options.createDropsVersion ? [] : (body.fields.fixVersions || []), status: { name: 'A fazer' } } });
      return { status: 201, json: { key, id: String(n) } };
    }
    const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
    if (m && method === 'GET') return issues.has(m[1]) ? { status: 200, json: issues.get(m[1]) } : { status: 404, json: null, text: 'nf' };
    if (m && method === 'PUT') {
      const set = body && body.update && body.update.fixVersions && body.update.fixVersions[0].set;
      if (set) issues.get(m[1]).fields.fixVersions = set.map((s) => versions.find((v) => v.id === s.id)).filter(Boolean).map((v) => ({ id: v.id, name: v.name }));
      else if (body && body.fields && body.fields.fixVersions) issues.get(m[1]).fields.fixVersions = []; // the PUT that came back empty
      return { status: 204, json: null };
    }
    const c = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/.exec(p);
    if (c && method === 'POST') { (issues.get(c[1]).comments = issues.get(c[1]).comments || []).push(body.body); return { status: 201, json: {} }; }
    if (method === 'GET' && /\/project\/[A-Z]+\/versions$/.test(p)) return { status: 200, json: versions };
    if (method === 'POST' && p === '/rest/api/3/issueLink') return { status: 201, json: null };
    return { status: 404, json: null, text: `no route ${method} ${p}` };
  };
  return { http, issues, calls };
}

function project(almBlock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-almw-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: almBlock, adr: false, docs_publish: false }));
  fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'enviar', acceptance: ['A1'] }] }));
  return dir;
}
const JIRA = { provider: 'jira', program: 'brd', jira: { project: 'OXE' }, epic: 'OXE-4', fix_version: '1.5.2' };

describe('ALM: one writer per program', () => {
  it('with alm.writer, a session that is not the writer cannot push/sync/move/defect; it can read and comment', async () => {
    const dir = project({ ...JIRA, writer: 'coord' });
    const j = fakeJira({ seed: [{ key: 'OXE-9' }] });
    const reader = { ...ENV, OXE_ALM_WRITER: 'outra' };
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: reader, sleep: async () => {} }), /só leitura.*"coord"/);
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'move', ref: 'OXE-9', stage: 'in_progress', http: j.http, env: reader }), /só leitura/);
    assert.equal(j.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing written');
    const dry = await op.runtimeAlm(dir, null, { action: 'push', dryRun: true, http: j.http, env: reader, sleep: async () => {} });
    assert.ok(dry.planned.length >= 1, 'a reader still sees the dry run');
    const c = await op.runtimeAlm(dir, null, { action: 'comment', ref: 'OXE-9', text: 'visto pela sessão de revisão', http: j.http, env: reader });
    assert.equal(c.commented, true);
    assert.equal(j.issues.get('OXE-9').comments.length, 1);
    const w = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'coord' }, sleep: async () => {} });
    assert.deepEqual(w.created.map((x) => x.ref), ['F1-T1']);
  });

  it('a second writer on the same machine is refused while the lock is held; a stale lock is taken over', async () => {
    const dir = project(JIRA);
    const pdir = path.join(dir, '.oxe', 'program');
    fs.mkdirSync(pdir, { recursive: true });
    const other = process.ppid; // alive and not us
    fs.writeFileSync(path.join(pdir, 'alm-write.lock'), JSON.stringify({ pid: other, at: new Date().toISOString() }));
    const j = fakeJira();
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} }), /outra sessão está escrevendo no ALM/);
    assert.equal(j.calls.length, 0);
    fs.writeFileSync(path.join(pdir, 'alm-write.lock'), JSON.stringify({ pid: other, at: new Date(Date.now() - 20 * 60_000).toISOString() }));
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(out.created.length, 1);
    assert.ok(!fs.existsSync(path.join(pdir, 'alm-write.lock')), 'released after the write');
  });

  it('no alm.writer → everyone writes, as before', () => {
    assert.equal(alm.isWriter(alm.almConfig({ alm: JIRA }), {}), true);
    assert.equal(alm.isWriter(alm.almConfig({ alm: { ...JIRA, writer: 'coord' } }), {}), false);
  });
});

describe('ALM: fix version by id (update.set)', () => {
  it('a create that dropped the version and an adopted item without it both get it through update.set with the id', async () => {
    const dir = project(JIRA);
    const j = fakeJira({ createDropsVersion: true });
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} });
    assert.deepEqual(out.versions.map((v) => [v.key, v.ok]), [['OXE-201', true]]);
    const put = j.calls.find((c) => c.method === 'PUT');
    assert.deepEqual(put.body, { update: { fixVersions: [{ set: [{ id: '10042' }] }] } });
    assert.deepEqual(j.issues.get('OXE-201').fields.fixVersions.map((v) => v.name), ['1.5.2']);

    const dir2 = project({ ...JIRA, adopt_prefixes: ['BRD'] });
    fs.writeFileSync(path.join(dir2, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'migrar BRD-7', acceptance: ['A1'] }] }));
    const k = fakeJira({ seed: [{ key: 'OXE-59', labels: ['ref-BRD-7'] }] });
    const adopted = await op.runtimeAlm(dir2, null, { action: 'push', http: k.http, env: ENV, sleep: async () => {} });
    assert.equal(adopted.reused[0].key, 'OXE-59');
    assert.deepEqual(k.issues.get('OXE-59').fields.fixVersions.map((v) => v.name), ['1.5.2']);
  });

  it('an item that already has the version is left alone (no PUT)', async () => {
    const dir = project(JIRA);
    const j = fakeJira();
    await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(j.calls.filter((c) => c.method === 'PUT').length, 0);
  });
});

describe('ALM: a repository workflow owns the later states (track + never backwards on the live state)', () => {
  it('track ["in_progress"]: the OXE only moves A fazer → Em andamento; an item a workflow already took to "Em revisão" is never pulled back', async () => {
    const STATES = { in_progress: 'Em andamento', in_review: 'Em revisão', queued: 'Na fila', merged: 'Na main', released: 'Lançado' };
    const cfg = alm.almConfig({ alm: { ...JIRA, states: STATES, track: ['in_progress'] } });
    const dir = project(JIRA);
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'F1-T1', key: 'OXE-9' });
    alm.addLink(pdir, { ref: 'F1-T2', key: 'OXE-10' });
    const j = fakeJira({ seed: [{ key: 'OXE-9' }, { key: 'OXE-10' }] });
    j.issues.get('OXE-9').fields.status = { name: 'Em revisão' }; // moved by jira-sync.yml
    const statuses = ['A fazer', ...Object.values(STATES)];
    const http = async (method, url, headers, body) => {
      const p = new URL(url).pathname;
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(p);
      if (m && method === 'GET') return { status: 200, json: { transitions: statuses.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
      if (m && method === 'POST') { j.issues.get(m[1]).fields.status = { name: statuses[Number(body.transition.id) - 1] }; return { status: 204, json: null }; }
      return j.http(method, url, headers, body);
    };
    const ev = [{ type: 'TaskStarted', work_item_id: 'T1' }, { type: 'TaskStarted', work_item_id: 'T2' }, { type: 'TaskPromoted', work_item_id: 'T2', payload: { pr: 'https://github.com/o/r/pull/3' } }];
    const r = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http, env: ENV, sleep: async () => {} });
    assert.equal(j.issues.get('OXE-9').fields.status.name, 'Em revisão', 'not pulled back to Em andamento');
    assert.ok(r.skipped.some((s) => s.ref === 'F1-T1' && /movido por outra ferramenta/.test(s.why)));
    assert.equal(j.issues.get('OXE-10').fields.status.name, 'Em andamento');
    assert.ok(r.skipped.some((s) => s.ref === 'F1-T2' && s.stage === 'review' && /alm\.track/.test(s.why)), 'the PR state is the workflow\'s');
  });
});

describe('ALM: stories_source "alm" — the cards already exist; the push only links, never creates a story or an epic', () => {
  it('a PRD story that names its card is linked by key (GET); one that does not is reported, never created; a task citing (OXE-n) is adopted by key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-almsrc-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, stories_source: 'alm' }, adr: false, docs_publish: false }));
    fs.writeFileSync(path.join(dir, '.oxe', 'PRD.md'), ['# PRD — Escala', '', '## Histórias de usuário', '', '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |', '|---|---|---|---|---|---|---|',
      '| US-1 | pessoa que usa | a mesma escala (OXE-48) | não estranhar | R1 | A1 | Must |', '| US-2 | pessoa que usa | atalhos | ir rápido | R2 | A2 | Should |', ''].join('\n'));
    fs.writeFileSync(path.join(dir, '.oxe', 'PLAN.json'), JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'tokens da escala (OXE-20)', acceptance: ['A1'] }] }));
    const j = fakeJira({ seed: [{ key: 'OXE-48' }, { key: 'OXE-20' }] });
    const out = await op.runtimeAlm(dir, null, { action: 'push', http: j.http, env: ENV, sleep: async () => {} });
    assert.deepEqual(out.created, [], 'nothing created: no story, no epic, no task (the task names its card)');
    assert.deepEqual(out.reused.map((r) => [r.ref, r.key, r.by_key]), [['US-1', 'OXE-48', true], ['F1-T1', 'OXE-20', true]]);
    assert.deepEqual(out.missing.map((m) => m.ref), ['US-2']);
    assert.match(out.missing[0].why, /não cita o card/);
    assert.equal(j.calls.filter((c) => c.method === 'POST' && /\/issue$/.test(new URL(c.url).pathname)).length, 0);
    assert.equal(alm.links(path.join(dir, '.oxe', 'program')).get('US-1').key, 'OXE-48');
  });
});
