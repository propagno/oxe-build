'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const op = require('../bin/lib/oxe-operational.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');
const admin = require('../bin/lib/oxe-alm-admin.cjs');

// 1.21.2 — the ALM commands that removed the ad-hoc scripts (coordination 14/11): intake (an item outside the PRD),
// doctor (the board checked against alm.states), version ensure, the usage log, and the alm help.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const CLI = path.join(__dirname, '..', 'bin', 'oxe-cc.js');
const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token', OXE_ALM_WRITER: 'w' };
// a board with these columns only: the default 'Done' of integrated/released is turned off explicitly (null)
const STATES = { intake: 'Backlog', grooming: 'Em grooming', in_progress: 'Em desenvolvimento', review: 'Em revisão', integrated: null, released: null };

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-almadm-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, writer: 'w', states: STATES, track: ['grooming', 'in_progress'] } }));
  return dir;
}

function fakeJira(options = {}) {
  const issues = new Map();
  const versions = [{ id: '10', name: '1.5.2', released: false }];
  const calls = [];
  let n = 140;
  const statuses = [{ id: '1', name: 'Backlog' }, { id: '2', name: 'Em grooming' }, { id: '3', name: 'Em desenvolvimento' }, { id: '4', name: 'Em revisão' }];
  const http = async (method, url, headers, body) => {
    calls.push({ method, url, body });
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/rest/api/3/myself') return { status: 200, json: { accountType: 'atlassian' } };
    if (p === '/rest/api/3/project/OXE' && method === 'GET') return { status: 200, json: { id: '100', key: 'OXE', name: 'OxeSpace' } };
    if (p === '/rest/api/3/project/OXE/statuses') return { status: 200, json: [{ name: 'Task', statuses: options.missingStatus ? statuses.slice(0, 3) : statuses }] };
    if (p === '/rest/agile/1.0/board') return { status: 200, json: { values: [{ id: 7, name: 'OXE board' }] } };
    if (p === '/rest/agile/1.0/board/7/configuration') {
      const cols = (options.outOfOrder ? [statuses[0], statuses[2], statuses[1], statuses[3]] : statuses).map((s) => ({ name: s.name, statuses: [{ id: s.id }] }));
      return { status: 200, json: { columnConfig: { columns: cols } } };
    }
    if (p === '/rest/api/3/search/jql') {
      const label = /labels = "([^"]+)"/.exec(u.searchParams.get('jql'))[1];
      return { status: 200, json: { issues: [...issues.values()].filter((i) => i.fields.labels.includes(label)).map((i) => ({ key: i.key })) } };
    }
    if (p === '/rest/api/3/issue' && method === 'POST') { n += 1; const key = `OXE-${n}`; issues.set(key, { key, fields: { ...body.fields, status: { name: 'Backlog' }, fixVersions: body.fields.fixVersions || [] } }); return { status: 201, json: { key, id: String(n) } }; }
    const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
    if (m && method === 'GET') return issues.has(m[1]) ? { status: 200, json: issues.get(m[1]) } : { status: 404, json: null, text: 'nf' };
    if (p === '/rest/api/3/project/OXE/versions') return { status: 200, json: versions };
    if (p === '/rest/api/3/version' && method === 'POST') { versions.push({ id: '11', name: body.name, released: false }); return { status: 201, json: { id: '11' } }; }
    return { status: 404, json: null, text: `no route ${method} ${p}` };
  };
  return { http, issues, calls, versions };
}

describe('alm intake', () => {
  it('creates an item outside the PRD with the skeleton of its type, records it, confirms by GET; a rerun reuses it; writer only; dry-run writes nothing', async () => {
    const dir = project();
    const j = fakeJira();
    const dry = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'A lateral pisca no Windows', epic: 'OXE-5', version: '1.5.2', ref: 'HML-1', dryRun: true, http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' } });
    assert.equal(dry.planned.type, 'Task');
    assert.ok(dry.planned.labels.includes('bug') && dry.planned.labels.includes('ref-p-HML-1'));
    assert.equal(j.calls.filter((c) => c.method !== 'GET').length, 0);
    await assert.rejects(op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'A lateral pisca no Windows', ref: 'HML-1', http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' } }), /só leitura/);
    const out = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'A lateral pisca no Windows', epic: 'OXE-5', version: '1.5.2', ref: 'HML-1', http: j.http, env: ENV });
    assert.equal(out.created, true);
    assert.equal(out.confirmed, true);
    assert.equal(out.status, 'Backlog');
    const it = j.issues.get(out.key);
    assert.equal(it.fields.parent.key, 'OXE-5');
    assert.ok(it.fields.description.content.some((nd) => nd.type === 'heading' && nd.content[0].text === 'Passos para reproduzir'), 'bug skeleton');
    assert.equal(alm.links(path.join(dir, '.oxe', 'program')).get('HML-1').key, out.key);
    const again = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'A lateral pisca no Windows', ref: 'HML-1', http: j.http, env: ENV });
    assert.equal(again.reused, true);
    assert.equal(j.issues.size, 1);
  });

  it('--from <file> becomes the description; an unknown type is refused', async () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, 'estudo.md'), '## Objetivo\n\nMedir o boot frio.\n');
    const j = fakeJira();
    const out = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'task', summary: 'Estudo: boot frio do OxeCode', from: 'estudo.md', http: j.http, env: ENV });
    assert.match(JSON.stringify(j.issues.get(out.key).fields.description), /Medir o boot frio/);
    await assert.rejects(op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'spike', summary: 'xxxxxxx', http: j.http, env: ENV }), /--type spike/);
  });
});

describe('alm doctor and version ensure', () => {
  it('doctor: credentials, project, every mapped stage exists, columns in the stages order — and says what is wrong', async () => {
    const dir = project();
    const ok = await op.runtimeAlmAdmin(dir, null, { action: 'doctor', http: fakeJira().http, env: ENV });
    assert.equal(ok.ok, true, JSON.stringify(ok.checks));
    const missing = await op.runtimeAlmAdmin(dir, null, { action: 'doctor', http: fakeJira({ missingStatus: true }).http, env: ENV });
    assert.ok(missing.checks.some((c) => c.name === 'estados' && !c.ok && /review → "Em revisão"/.test(c.detail)));
    const order = await op.runtimeAlmAdmin(dir, null, { action: 'doctor', http: fakeJira({ outOfOrder: true }).http, env: ENV });
    assert.ok(order.checks.some((c) => c.name === 'colunas' && !c.ok && /fora da ordem/.test(c.detail)));
  });

  it('version ensure: existing → nothing; missing → created (writer only; dry-run plans)', async () => {
    const dir = project();
    const j = fakeJira();
    assert.equal((await op.runtimeAlmAdmin(dir, null, { action: 'version', name: '1.5.2', http: j.http, env: ENV })).exists, true);
    assert.equal((await op.runtimeAlmAdmin(dir, null, { action: 'version', name: '1.5.3', dryRun: true, http: j.http, env: ENV })).planned, 'criar');
    const c = await op.runtimeAlmAdmin(dir, null, { action: 'version', name: '1.5.3', http: j.http, env: ENV });
    assert.equal(c.created, true);
    assert.ok(j.versions.some((v) => v.name === '1.5.3'));
  });
});

describe('alm usage log and help', () => {
  it('every alm command is logged (command, ok, ms, error); alm usage summarizes; alm --help and alm <sub> --help print usage', () => {
    const dir = project();
    const run = (...a) => spawnSync(process.execPath, [CLI, 'alm', ...a, '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', JIRA_SITE: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '' } });
    run('status');
    run('doctor'); // fails: no credentials in env
    const log = fs.readFileSync(path.join(dir, '.oxe', 'alm', 'usage.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((r) => [r.cmd, r.ok]), [['alm status', true], ['alm doctor', false]]);
    assert.match(log[1].error, /variável de ambiente JIRA_SITE/);
    assert.ok(!JSON.stringify(log).includes('secret'), 'no secret in the log');
    assert.equal(admin.usageReport(dir).commands.find((c) => c.cmd === 'alm doctor').failed, 1);
    const h = spawnSync(process.execPath, [CLI, 'alm', '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(h.status, 0);
    assert.match(h.stdout, /intake +item novo fora do PRD/);
    const hs = spawnSync(process.execPath, [CLI, 'alm', 'refine', '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(hs.stdout, /Exemplo: oxe-cc alm refine OXE-20/);
  });
});

describe('OXE-292: the project Bug type and the card priority', () => {
  // a Jira with a Bug issue type and the default priorities
  function jira2(withBug) {
    const issues = new Map();
    const calls = [];
    let n = 290;
    const http = async (method, url, headers, body) => {
      calls.push({ method, url, body });
      const u = new URL(url);
      const p = u.pathname;
      if (p === '/rest/api/3/project/OXE' && method === 'GET') return { status: 200, json: { id: '100', key: 'OXE', issueTypes: [{ name: 'Task' }, { name: 'Story' }, ...(withBug ? [{ name: 'Bug' }] : [])] } };
      if (p === '/rest/api/3/priority') return { status: 200, json: [{ name: 'Highest' }, { name: 'High' }, { name: 'Medium' }, { name: 'Low' }] };
      if (p === '/rest/api/3/search/jql') return { status: 200, json: { issues: [] } };
      if (p === '/rest/api/3/issue' && method === 'POST') { n += 1; const key = `OXE-${n}`; issues.set(key, { key, fields: { ...body.fields, status: { name: 'Backlog' }, fixVersions: [] } }); return { status: 201, json: { key } }; }
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
      if (m && method === 'GET') return issues.has(m[1]) ? { status: 200, json: issues.get(m[1]) } : { status: 404, json: null, text: 'nf' };
      if (m && method === 'PUT') { const it = issues.get(m[1]); if (it && body.fields.priority) it.fields.priority = { name: body.fields.priority.name }; return { status: 204, json: null }; }
      return { status: 404, json: null, text: `no route ${method} ${p}` };
    };
    return { http, issues, calls };
  }

  it('a project with a Bug type gets a Bug; without it, Task with the label (as before)', async () => {
    const dir = project();
    const j = jira2(true);
    const out = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'O release quebra no Windows', ref: 'REL-1', http: j.http, env: ENV });
    assert.equal(out.type, 'Bug');
    assert.equal(j.issues.get(out.key).fields.issuetype.name, 'Bug');
    const j2 = jira2(false);
    const dir2 = project();
    const out2 = await op.runtimeAlmAdmin(dir2, null, { action: 'intake', type: 'bug', summary: 'O release quebra no Windows', ref: 'REL-2', http: j2.http, env: ENV });
    assert.equal(out2.type, 'Task');
  });

  it('intake --priority and alm priority set it, validated against the instance and confirmed by GET', async () => {
    const dir = project();
    const j = jira2(true);
    const out = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'O release quebra no Windows', ref: 'REL-3', priority: 'high', http: j.http, env: ENV });
    assert.equal(j.issues.get(out.key).fields.priority.name, 'High', 'matched case-insensitively');
    assert.equal(out.priority, 'High');
    const set = await op.runtimeAlmAdmin(dir, null, { action: 'priority', key: out.key, name: 'Highest', http: j.http, env: ENV });
    assert.equal(set.confirmed, true);
    assert.equal(j.issues.get(out.key).fields.priority.name, 'Highest');
    await assert.rejects(op.runtimeAlmAdmin(dir, null, { action: 'priority', key: out.key, name: 'Urgentíssima', http: j.http, env: ENV }), /prioridade "Urgentíssima" não existe no Jira/);
    await assert.rejects(op.runtimeAlmAdmin(dir, null, { action: 'priority', key: out.key, name: 'High', http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' } }), /escritor|writer/i);
  });

  it('R54: ignores subtask Bug/Defeito issue types so top-level intake does not 400', async () => {
    const dir = project();
    const j = jira2(false);
    const origHttp = j.http;
    const subBugHttp = async (method, url, headers, body) => {
      if (new URL(url).pathname === '/rest/api/3/project/OXE' && method === 'GET') {
        return { status: 200, json: { id: '100', key: 'OXE', issueTypes: [{ name: 'Task', subtask: false }, { name: 'Defeito', subtask: true }] } };
      }
      return origHttp(method, url, headers, body);
    };
    const out = await op.runtimeAlmAdmin(dir, null, { action: 'intake', type: 'bug', summary: 'Falha de tela no login', ref: 'REL-SUB', http: subBugHttp, env: ENV });
    assert.equal(out.type, 'Task');
  });
});
