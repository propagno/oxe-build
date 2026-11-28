'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const op = require(path.join(__dirname, '..', 'bin', 'lib', 'oxe-operational.cjs'));
const metrics = require(path.join(__dirname, '..', 'bin', 'lib', 'oxe-alm-metrics.cjs'));

// oxespace 28/11: `alm metrics` stopped at 300 of 434 cards (default cap + ORDER BY created ASC), so the newest
// releases were missing from throughput; a card with a long history also lost its later status changes.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-alm-metrics-'));
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({
    alm: { provider: 'jira', jira: { site: 'https://example.atlassian.net', project: 'OXE' }, states: { in_progress: 'Em desenvolvimento', released: 'Lançado' } },
  }));
  return dir;
}

const status = (name, id) => ({ name, id });
const hist = (at, from, to) => ({ created: at, items: [{ field: 'status', fromString: from, toString: to, from: from === 'A fazer' ? '1' : '2', to: to === 'Lançado' ? '3' : '2' }] });

function card(n, week) {
  return {
    key: `OXE-${n}`,
    fields: { created: '2026-11-02T10:00:00.000Z', status: status('Lançado', '3'), summary: `c${n}` },
    changelog: { total: 2, histories: [hist('2026-11-03T10:00:00.000Z', 'A fazer', 'Em desenvolvimento'), hist(week, 'Em desenvolvimento', 'Lançado')] },
  };
}

function fakeJira(calls) {
  const pages = [
    { issues: [card(1, '2026-11-12T10:00:00.000Z'), card(2, '2026-11-12T10:00:00.000Z')], nextPageToken: 'p2', isLast: false },
    { issues: [card(3, '2026-11-26T10:00:00.000Z')], nextPageToken: 'p3', isLast: false },
    {
      issues: [{
        key: 'OXE-4',
        fields: { created: '2026-11-02T10:00:00.000Z', status: status('Lançado', '3'), summary: 'long history' },
        // the search embeds only the first history entry; the release is on the changelog endpoint
        changelog: { total: 2, histories: [hist('2026-11-03T10:00:00.000Z', 'A fazer', 'Em desenvolvimento')] },
      }],
      isLast: true,
    },
  ];
  return async (method, url, headers, body) => {
    calls.push(`${method} ${url}`);
    if (method === 'POST' && /approximate-count$/.test(url)) {
      assert.ok(!/ORDER BY/i.test(body.jql), 'approximate-count não aceita ORDER BY');
      return { status: 200, json: { count: 4 } };
    }
    if (/\/issue\/OXE-4\/changelog/.test(url)) {
      return { status: 200, json: { values: [hist('2026-11-03T10:00:00.000Z', 'A fazer', 'Em desenvolvimento'), hist('2026-11-26T10:00:00.000Z', 'Em desenvolvimento', 'Lançado')], total: 2, isLast: true } };
    }
    const token = /nextPageToken=([^&]+)/.exec(url);
    const page = !token ? pages[0] : token[1] === 'p2' ? pages[1] : pages[2];
    return { status: 200, json: page };
  };
}

const env = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' };

describe('alm metrics — todas as páginas e o changelog completo', () => {
  it('lê todos os cards por padrão (sem teto de 300) e conta a vazão pela data de entrada em Lançado', async () => {
    const dir = project();
    try {
      const calls = [];
      const m = await op.runtimeAlmMetrics(dir, null, { http: fakeJira(calls), env, now: Date.parse('2026-11-28T12:00:00.000Z') });
      assert.equal(m.cards, 4);
      assert.equal(m.total, 4);
      assert.equal(m.truncated, false);
      assert.deepEqual(m.throughput, [{ week: '2026-W46', done: 2 }, { week: '2026-W48', done: 2 }]);
      assert.ok(calls.some((c) => /\/issue\/OXE-4\/changelog/.test(c)), 'changelog cortado não foi completado');
      assert.equal(metrics.cardsLabel(m), '4 card(s)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('com --max, para no limite e diz "N de M"', async () => {
    const dir = project();
    try {
      const m = await op.runtimeAlmMetrics(dir, null, { http: fakeJira([]), env, max: 2, now: Date.parse('2026-11-28T12:00:00.000Z') });
      assert.equal(m.cards, 2);
      assert.equal(m.total, 4);
      assert.equal(m.truncated, true);
      assert.match(metrics.cardsLabel(m), /^2 de 4 card\(s\)/);
      assert.match(fs.readFileSync(path.join(dir, '.oxe', 'alm', 'metrics.md'), 'utf8'), /2 de 4 card\(s\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('alm metrics — coluna terminal', () => {
  it('o tempo em Lançado não conta a permanência aberta depois do lançamento', () => {
    const now = Date.parse('2026-11-28T12:00:00.000Z');
    const issues = [{ key: 'OXE-1', created: '2026-11-20T00:00:00.000Z', status: 'Lançado', changes: [{ at: '2026-11-21T00:00:00.000Z', from: 'Em desenvolvimento', to: 'Lançado' }] }];
    const m = metrics.compute(issues, { states: { in_progress: 'Em desenvolvimento', released: 'Lançado' }, stages: ['in_progress', 'released'] }, { now });
    const released = m.columns.find((c) => c.column === 'Lançado');
    assert.equal(released.now, 1);
    assert.equal(released.passed, 0);
    assert.equal(released.median_days, null);
    assert.equal(m.columns.find((c) => c.column === 'Em desenvolvimento').median_days, 1);
    assert.deepEqual(m.throughput, [{ week: '2026-W47', done: 1 }]);
  });
});

describe('alm — 401 com token renovado só na variável de usuário', () => {
  it('diz que o processo carrega o token antigo; com o mesmo valor, aponta token revogado', async () => {
    const alm = require(path.join(__dirname, '..', 'bin', 'lib', 'oxe-alm.cjs'));
    const cfg = alm.almConfig({ alm: { provider: 'jira', jira: { site: 'https://example.atlassian.net', project: 'OXE' } } }, { defaultProgram: 'p' });
    const http = async () => ({ status: 401, json: null, text: '' });
    const stale = alm.jiraRest(cfg, { http, env, userEnv: (n) => (n === 'JIRA_API_TOKEN' ? 'novo' : env[n]) });
    await assert.rejects(stale.request('GET', 'https://example.atlassian.net/rest/api/3/myself'), /JIRA_API_TOKEN neste processo difere da variável de usuário/);
    const same = alm.jiraRest(cfg, { http, env, userEnv: (n) => env[n] });
    await assert.rejects(same.request('GET', 'https://example.atlassian.net/rest/api/3/myself'), /revogado ou expirou/);
  });
});
