'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prs = require('../bin/lib/oxe-alm-prs.cjs');

// OxeSpace 15/11 (coordinator, OXE-277): a PR that is only part of a card moved it to "Na main". The markers decide:
// "Fecha/Closes KEY" moves, "Parte de/Part of KEY" comments, a bare key is reported only.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const cfg = { provider: 'jira', p: { project: 'OXE' }, states: { integrated: 'Na main', in_progress: 'Em andamento' } };

describe('alm pr-merged: Fecha moves, Parte de comments, a bare key is reported', () => {
  it('reads the markers from title, body and commit trailers; closed wins over partial', () => {
    const m = prs.prMarkers([
      'T5: about (OXE-105)',
      'wt/f6-t5-oxe-105',
      'Fecha OXE-72 e OXE-170\n\nParte de OXE-102, OXE-105',
      'feat: x\n\nParte-de: OXE-12\nCloses: OXE-102',
    ], cfg);
    assert.deepEqual(m.closes, ['OXE-102', 'OXE-170', 'OXE-72']);
    assert.deepEqual(m.partial, ['OXE-105', 'OXE-12']);
    assert.deepEqual(m.bare, []);
    assert.deepEqual(prs.prMarkers(['T9: só a chave (OXE-9)'], cfg).bare, ['OXE-9']);
  });

  it('dry run plans; apply moves the closed once, comments the partial, never moves a bare key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-prm-'));
    dirs.push(dir);
    const programDir = path.join(dir, '.oxe', 'program');
    const calls = [];
    const almLib = {
      async move(_pd, _c, key, stage, o) { calls.push(['move', key, stage, o.comment]); return { key, changed: true }; },
      async comment(_pd, _c, key, text) { calls.push(['comment', key, text]); return { key }; },
    };
    const prData = { number: 871, url: 'https://x/pull/871', state: 'MERGED', title: 'T5 (OXE-9)', branch: 'b', body: 'Fecha OXE-72\nParte de OXE-105', commits: [] };
    const dry = await prs.prMerged(dir, programDir, cfg, almLib, { prData });
    assert.equal(dry.dry_run, true);
    assert.deepEqual(dry.close.map((c) => c.key), ['OXE-72']);
    assert.deepEqual(dry.bare, ['OXE-9']);
    assert.equal(calls.length, 0, 'dry run writes nothing');
    const out = await prs.prMerged(dir, programDir, cfg, almLib, { prData, apply: true });
    assert.deepEqual(out.moved.map((m) => m.key), ['OXE-72']);
    assert.deepEqual(out.commented, ['OXE-105']);
    assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['move', 'OXE-72', 'integrated'], ['comment', 'OXE-105', calls[1][2]]]);
    assert.ok(!calls.some((c) => c[1] === 'OXE-9'), 'the bare key is not moved');
    const again = await prs.prMerged(dir, programDir, cfg, almLib, { prData, apply: true });
    assert.equal(again.moved.length + again.commented.length, 0, 'once: the ledger skips what this PR already did');
    await assert.rejects(prs.prMerged(dir, programDir, cfg, almLib, { prData: { ...prData, state: 'OPEN' }, apply: true }), /não está mergeado/);
  });

  it('a task PR says Fecha only when no other open task shares the card', () => {
    const doc = { tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3', done: true }, { id: 'T4', superseded: { by_phase: 'F5' } }] };
    const keyOf = (id) => ({ T1: 'OXE-5', T2: 'OXE-5', T3: 'OXE-5', T4: 'OXE-5' }[id]);
    assert.deepEqual(prs.prMarkerFor('OXE-5', 'T1', doc, keyOf), { marker: 'Parte de OXE-5', open_tasks: ['T2'] });
    assert.equal(prs.prMarkerFor('OXE-5', 'T1', { tasks: [{ id: 'T1' }, { id: 'T3', done: true }] }, keyOf).marker, 'Fecha OXE-5');
  });
});

describe('runtimeAlm pr-merged / list against a fake Jira', () => {
  const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 't', OXE_ALM_WRITER: 'w1' };
  const STATES = { in_progress: 'Em desenvolvimento', integrated: 'Na main', accepted: 'Entregue com prova' };
  function jira() {
    const issues = new Map([['OXE-72', 'Em desenvolvimento'], ['OXE-105', 'Em desenvolvimento'], ['OXE-9', 'Em desenvolvimento'], ['OXE-1', 'Na main']].map(([k, s]) => [k, { key: k, status: s, comments: [] }]));
    const names = Object.values(STATES);
    const http = async (method, url, _h, body) => {
      const u = new URL(url);
      const p = u.pathname;
      if (method === 'GET' && p === '/rest/api/3/search/jql') {
        const st = /status in \(([^)]*)\)/.exec(u.searchParams.get('jql') || '');
        const want = st ? [...st[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
        return { status: 200, json: { issues: [...issues.values()].filter((i) => !st || want.includes(i.status)).map((i) => ({ key: i.key, id: i.key, fields: { summary: `card ${i.key}`, status: { name: i.status } } })), isLast: true } };
      }
      let m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
      if (m && method === 'GET') return { status: 200, json: { key: m[1], fields: { status: { name: issues.get(m[1]).status } } } };
      m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(p);
      if (m && method === 'GET') return { status: 200, json: { transitions: names.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
      if (m && method === 'POST') { issues.get(m[1]).status = names[Number(body.transition.id) - 1]; return { status: 204, json: null }; }
      m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/.exec(p);
      if (m && method === 'POST') { issues.get(m[1]).comments.push(body.body); return { status: 201, json: {} }; }
      if (m && method === 'GET') return { status: 200, json: { comments: [] } };
      return { status: 404, json: null, text: `no route ${method} ${p}` };
    };
    return { http, issues };
  }
  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-prm2-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ docs_publish: false, adr: false, alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, writer: 'w1', states: STATES } }));
    return dir;
  }
  const op = require('../bin/lib/oxe-operational.cjs');
  const prData = { number: 871, url: 'https://x/pull/871', state: 'MERGED', title: 'T5 (OXE-9)', branch: 'b', body: 'Fecha OXE-72\nParte de OXE-105', commits: [] };

  it('pr-merged: a dry run moves nothing; --apply moves only the closed card and comments the partial one', async () => {
    const dir = project();
    const j = jira();
    const dry = await op.runtimeAlm(dir, null, { action: 'pr-merged', prData, http: j.http, env: ENV, sleep: async () => {} });
    assert.equal(dry.dry_run, true);
    assert.equal(j.issues.get('OXE-72').status, 'Em desenvolvimento');
    const out = await op.runtimeAlm(dir, null, { action: 'pr-merged', prData, apply: true, http: j.http, env: ENV, sleep: async () => {} });
    assert.deepEqual(out.errors, []);
    assert.equal(j.issues.get('OXE-72').status, 'Na main');
    assert.equal(j.issues.get('OXE-105').status, 'Em desenvolvimento');
    assert.equal(j.issues.get('OXE-105').comments.length, 1);
    assert.equal(j.issues.get('OXE-9').status, 'Em desenvolvimento', 'bare key not moved');
  });

  it('list: the cards in the given states, with the merged PRs citing each one', async () => {
    const dir = project();
    const j = jira();
    const ghFake = () => ({ status: 0, stdout: JSON.stringify([{ number: 10, title: 'T1', body: 'Fecha OXE-1', headRefName: 'b', url: 'u', mergedAt: 'x' }]) });
    const out = await op.runtimeAlm(dir, null, { action: 'list', state: 'Na main,Entregue com prova', withPrs: true, ghSpawn: ghFake, http: j.http, env: ENV, sleep: async () => {} });
    assert.deepEqual(out.cards.map((c) => c.key), ['OXE-1']);
    assert.deepEqual(out.cards[0].prs.map((p) => [p.pr, p.kind]), [[10, 'closes']]);
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'list', http: j.http, env: ENV }), /uso: oxe-cc alm list --state/);
  });
});

describe('alm list --with-prs: merged PRs by key', () => {
  it('joins each key to the merged PRs that cite it, with the kind', () => {
    const fake = () => ({ status: 0, stdout: JSON.stringify([
      { number: 10, title: 'T1 (OXE-1)', body: 'Fecha OXE-1', headRefName: 'b1', url: 'u10', mergedAt: '2026-11-15' },
      { number: 11, title: 'T2', body: 'Parte de OXE-1\nFecha OXE-2', headRefName: 'b2', url: 'u11', mergedAt: '2026-11-15' },
    ]) });
    const map = prs.mergedPrsByKey('.', cfg, { ghSpawn: fake });
    assert.deepEqual(map.get('OXE-1').map((p) => [p.pr, p.kind]), [[10, 'closes'], [11, 'partial']]);
    assert.deepEqual(map.get('OXE-2').map((p) => [p.pr, p.kind]), [[11, 'closes']]);
  });
});
