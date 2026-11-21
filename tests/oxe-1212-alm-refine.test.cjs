'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const refine = require('../bin/lib/oxe-alm-refine.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — `alm refine` (user request 14/11): the Jira cards re-read into a guided spec per type, linted, applied by
// the writer only, never overwriting a card edited after the collect; ready_gate keeps unrefined items out of work.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token', OXE_ALM_WRITER: 'oxespace-69' };
const adf = (t) => ({ type: 'doc', version: 1, content: t.split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });

function fakeJira() {
  const issues = new Map([
    ['OXE-20', { id: '10020', key: 'OXE-20', fields: { summary: 'Enviar texto do desktop para o celular', description: adf('O operador quer mandar o texto para o celular.\n\nVer src/send/bridge.ts e BRD-7.'), issuetype: { name: 'História' }, status: { name: 'A fazer' }, labels: ['area-celular'], parent: { key: 'OXE-4', fields: { summary: 'Celular' } }, issuelinks: [{ type: { outward: 'relates to', inward: 'relates to' }, outwardIssue: { key: 'OXE-21', fields: { summary: 'Status do envio', status: { name: 'A fazer' } } } }], comment: { comments: [{ author: { displayName: 'PO' }, created: '2026-11-12', body: adf('Precisa funcionar offline.') }] }, fixVersions: [{ name: '1.5.2' }] } }],
    ['OXE-103', { id: '10103', key: 'OXE-103', fields: { summary: 'thread-view pisca na abertura', description: adf('Às vezes a lateral aparece.'), issuetype: { name: 'Tarefa' }, labels: ['bug'], status: { name: 'Em andamento' }, issuelinks: [], comment: { comments: [] }, fixVersions: [] } }],
  ]);
  const calls = [];
  const http = async (method, url, headers, body) => {
    calls.push({ method, url, body });
    const u = new URL(url);
    const p = u.pathname;
    let m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
    if (m && method === 'GET') return issues.has(m[1]) ? { status: 200, json: issues.get(m[1]) } : { status: 404, json: null, text: 'nf' };
    if (m && method === 'PUT') {
      const it = issues.get(m[1]);
      if (body.fields && body.fields.description) it.fields.description = body.fields.description;
      for (const l of (body.update && body.update.labels) || []) {
        if (l.add && !it.fields.labels.includes(l.add)) it.fields.labels.push(l.add);
        if (l.remove) it.fields.labels = it.fields.labels.filter((x) => x !== l.remove);
      }
      return { status: 204, json: null };
    }
    m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/.exec(p);
    if (m && method === 'POST') { issues.get(m[1]).fields.comment.comments.push({ author: { displayName: 'oxe' }, created: 'now', body: body.body }); return { status: 201, json: {} }; }
    if (p === '/rest/dev-status/latest/issue/summary') return { status: 200, json: { summary: { pullrequest: { overall: { count: 2 } }, repository: { overall: { count: 5 } }, build: { overall: { count: 1 } } } } };
    if (p === '/rest/api/3/search/jql') return { status: 200, json: { issues: [{ key: 'OXE-20' }, { key: 'OXE-103' }] } };
    return { status: 404, json: null, text: `no route ${method} ${p}` };
  };
  return { http, issues, calls };
}

function project(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-refine-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'send'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'send', 'bridge.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, '.oxe', 'config.json'), JSON.stringify({ alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, writer: 'oxespace-69', ...extra } }));
  return dir;
}

const GOOD_STORY = (key = 'OXE-20') => `<!-- oxe-refine: ${key} -->
# ${key} — Enviar texto do desktop para o celular

## História

Como **operador**, quero **enviar o texto do desktop para o celular**, para **não digitar duas vezes** (card).

## Contexto

O operador manda o texto pelo bridge (src/send/bridge.ts).

## Critérios de aceite

1. **CA-1** — Dado um celular pareado, quando o operador envia um texto de até 4000 caracteres, então ele aparece no celular em até 2 s · Teste: e2e/send.spec.ts › envia texto
2. **CA-2** — Dado o celular offline, quando o operador envia, então o texto fica na fila e é entregue ao reconectar · Teste: e2e/send.spec.ts › fila offline

## Regras de negócio

- **RN-1** — O envio offline entra na fila (comentário de 12/11).

## Regras técnicas

- **RT-1** — O envio passa por src/send/bridge.ts (código).

## Fora de escopo

- Enviar arquivos e imagens.

## Dependências

- OXE-21 (relates to)

## Riscos

- A confirmar

## Definição de pronto

- Critérios com teste verde no CI

## Referências

- Card: OXE-20

## Perguntas em aberto

- Qual o risco aceito para perda da fila offline ao fechar o app?
`;

describe('alm refine: collect (read-only)', () => {
  it('reads the whole card (comments, links, epic, dev summary, code and design refs) and writes the skeleton of its type; nothing written in Jira', async () => {
    const dir = project();
    const j = fakeJira();
    const out = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20', 'OXE-103'], http: j.http, env: ENV });
    assert.deepEqual(out.results.map((r) => [r.key, r.kind]), [['OXE-20', 'story'], ['OXE-103', 'bug']]);
    assert.equal(j.calls.filter((c) => c.method !== 'GET').length, 0, 'collect only reads');
    const c = JSON.parse(fs.readFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-20.json'), 'utf8'));
    assert.equal(c.comments[0].text, 'Precisa funcionar offline.');
    assert.deepEqual(c.code_refs_found, ['src/send/bridge.ts']);
    assert.ok(c.design_refs.includes('BRD-7'));
    assert.deepEqual(c.dev, { pullrequests: 2, commits: 5, builds: 1 });
    const story = fs.readFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), 'utf8');
    for (const s of ['## História', '## Critérios de aceite', '## Regras de negócio', '## Regras técnicas', '## Fora de escopo', '## Definição de pronto']) assert.ok(story.includes(s), s);
    assert.match(story, /Épico\/pai: OXE-4 — Celular/);
    const bug = fs.readFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-103.md'), 'utf8');
    for (const s of ['## Passos para reproduzir', '## Resultado esperado', '## Resultado obtido', '## Teste de regressão']) assert.ok(bug.includes(s), s);
    // a rewritten spec is kept on a second collect (only --reset recreates it)
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY());
    const again = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], http: j.http, env: ENV });
    assert.equal(again.results[0].kept, true);
  });

  it('batch by JQL respects --max-cards (a bigger batch needs the user)', async () => {
    const dir = project();
    const j = fakeJira();
    await assert.rejects(op.runtimeAlmRefine(dir, null, { action: 'collect', jql: 'fixVersion = 1.5.2', maxCards: 1, http: j.http, env: ENV }), /teto --max-cards 1/);
  });
});

describe('alm refine: lint', () => {
  it('the raw skeleton fails; vague criterion, criterion without test, empty out-of-scope and A confirmar without question are caught', () => {
    const c = { key: 'OXE-1', url: 'u', kind: 'story', type: 'Story', status: 'A fazer', summary: 'x', description: '', description_hash: 'h', labels: [], parent: null, links: [], comments: [], fix_versions: [], dev: null, code_refs: [], code_refs_found: [], design_refs: [], collected_at: 'now' };
    assert.equal(refine.lintSpec(refine.skeleton(c), 'story').ok, false);
    // OxeSpace 15/11 (OXE-166..169): a card written by alm intake --from <spec> keeps its sections — never reset to
    // "A confirmar", never the whole description under Contexto cut after ~12 lines
    const spec = ['O chat novo da 1.5.2.', '', '## História', '', 'Como **operador**, quero **ver cada chamada**, para **confiar no agente**.', '', '## Critérios de aceite', '',
      ...[1, 2, 3, 4, 5, 6].map((n) => `${n}. **CA-${n}** — Dado o chat, quando a chamada ${n} roda, então aparece em 200 ms · Teste: tests/chat.test.ts`), '',
      '## Regras de negócio', '', '- **RN-1** — uma chamada por linha', '', '## Regras técnicas', '', '- **RT-1** — sem pacote novo'].join('\n');
    const kept = refine.skeleton({ ...c, description: spec });
    const secs = new Map([...kept.replace(/<!--[\s\S]*?-->/g, '').split(/^## /m)].slice(1).map((b) => [b.split('\n')[0].trim(), b]));
    assert.match(secs.get('História'), /quero \*\*ver cada chamada\*\*/);
    assert.match(secs.get('Critérios de aceite'), /CA-6/, 'not cut after CA-3');
    assert.match(secs.get('Regras de negócio'), /RN-1\*\* — uma chamada por linha/);
    assert.match(secs.get('Regras técnicas'), /sem pacote novo/);
    assert.match(secs.get('Contexto'), /^Contexto\n+O chat novo da 1\.5\.2\./);
    assert.doesNotMatch(secs.get('Contexto'), /CA-1/, 'the sections do not go under Contexto');
    const bad = GOOD_STORY().replace('em até 2 s · Teste: e2e/send.spec.ts › envia texto', 'de forma rápida · Teste: A confirmar').replace('- Enviar arquivos e imagens.', '- A confirmar').replace('- Qual o risco aceito para perda da fila offline ao fechar o app?', '');
    const r = refine.lintSpec(bad, 'story');
    assert.ok(r.errors.some((e) => /CA-1 é vago \("rápid/.test(e)));
    assert.ok(r.errors.some((e) => /CA-1 sem o teste/.test(e)));
    assert.ok(r.errors.some((e) => /Fora de escopo sem nenhum item/.test(e)));
    assert.ok(r.errors.some((e) => /"A confirmar" sem pergunta/.test(e)));
    // OxeSpace 15/11 (OXE-274): "para confirmar" in prose is not the marker; "(A confirmar)" and "- A confirmar" are
    const prose = GOOD_STORY().replace('- A confirmar', '- Perda aceita.').replace('- Qual o risco aceito para perda da fila offline ao fechar o app?', '- Nenhuma')
      .replace('## Dependências', 'O operador quer o envio, para confirmar com segurança que chegou; e reconfirmar depois.\n\n## Dependências');
    assert.match(prose, /para confirmar com segurança/);
    const pr = refine.lintSpec(prose, 'story');
    assert.ok(!pr.errors.some((e) => /"A confirmar" sem pergunta/.test(e)), pr.errors.join(' | '));
    assert.equal(pr.needs_info, false);
    for (const yes of ['_(A confirmar)_', '- A confirmar', 'Teste: a confirmar', 'Teste: A confirmar', '_A confirmar_', '_a confirmar_', '**a confirmar**', '- a confirmar', '1. a confirmar', 'a confirmar', 'Desconhecida (A confirmar)', '— a confirmar (arquivos)']) {
      assert.ok(refine.TBC_RE.test(yes), `marker: ${yes}`);
    }
    for (const no of ['para confirmar', 'a confirmarão', 'obrigando-o a confirmar a exclusão', 'ajuda a confirmar o envio', 'volta a confirmar.', 'reconfirmar']) {
      assert.ok(!refine.TBC_RE.test(no), `prose: ${no}`);
    }
  });

  it('a good story passes, with its criteria and the open question (needs-info)', () => {
    const r = refine.lintSpec(GOOD_STORY(), 'story');
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.criteria.map((c) => [c.id, c.test]), [['CA-1', 'e2e/send.spec.ts › envia texto'], ['CA-2', 'e2e/send.spec.ts › fila offline']]);
    assert.equal(r.needs_info, true);
    assert.equal(r.questions.length, 1);
  });
});

describe('alm refine: apply (writer only, idempotent, never over a later human edit)', () => {
  async function ready() {
    const dir = project();
    const j = fakeJira();
    await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], http: j.http, env: ENV });
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY());
    return { dir, j };
  }

  it('a reader session cannot apply', async () => {
    const { dir, j } = await ready();
    await assert.rejects(op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: { ...ENV, OXE_ALM_WRITER: 'outra' } }), /só leitura/);
  });

  it('the description becomes the spec in ADF with headings; the original goes to a comment; spec-v1 + needs-info with the questions; a second apply changes nothing', async () => {
    const { dir, j } = await ready();
    const out = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV });
    const r = out.results[0];
    assert.equal(r.applied, true);
    assert.equal(r.confirmed, true);
    const it = j.issues.get('OXE-20');
    assert.ok(it.fields.description.content.some((n) => n.type === 'heading' && n.content[0].text === 'Critérios de aceite'));
    assert.deepEqual(it.fields.labels.sort(), ['area-celular', 'needs-info', 'spec-v1']);
    const texts = it.fields.comment.comments.map((c) => refine.adfToText(c.body));
    assert.ok(texts.some((t) => /Texto original \(antes do refine\)[\s\S]*O operador quer mandar/.test(t)));
    assert.ok(texts.some((t) => /Perguntas em aberto[\s\S]*perda da fila offline/.test(t)));
    const again = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV });
    assert.equal(again.results[0].unchanged, true);
    // an amended spec is v2: spec-v1 stays (the ready gate), spec-v2 is added, the marker says v2 (OxeSpace 14/11)
    const specFile = path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md');
    fs.appendFileSync(specFile, '\nNota da emenda de 14/11.\n');
    const amended = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV, confirmOverwrite: true });
    assert.equal(amended.results[0].version, 2, JSON.stringify(amended.results[0]));
    assert.ok(j.issues.get('OXE-20').fields.labels.includes('spec-v1'));
    assert.ok(j.issues.get('OXE-20').fields.labels.includes('spec-v2'));
    assert.match(refine.adfToText(j.issues.get('OXE-20').fields.description), /oxe-refine spec-v2 · sha/);
    assert.ok(j.issues.get('OXE-20').fields.labels.includes('needs-info'), 'questions still open: needs-info stays');
    // OxeSpace 15/11 (OXE-189): the question answered and recorded → the next apply takes needs-info off
    const answered = fs.readFileSync(specFile, 'utf8')
      .replace(/## Riscos\n\n- A confirmar/, '## Riscos\n\n- Perda da fila offline ao fechar: aceita (decisão do PO, 15/11)')
      .replace(/## Perguntas em aberto\n\n- Qual o risco aceito[^\n]*/, '## Perguntas em aberto\n\n- Nenhuma');
    assert.doesNotMatch(answered, /a confirmar/i, 'fixture: no open question left');
    fs.writeFileSync(specFile, answered);
    const cleared = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV, confirmOverwrite: true });
    assert.deepEqual(cleared.results[0].removed, ['needs-info'], JSON.stringify(cleared.results[0]));
    assert.equal(cleared.results[0].confirmed, true);
    assert.ok(!j.issues.get('OXE-20').fields.labels.includes('needs-info'));
    assert.ok(j.issues.get('OXE-20').fields.labels.includes('spec-v1'));
  });

  it('a card edited by a person after the collect is not overwritten without --confirm-overwrite', async () => {
    const { dir, j } = await ready();
    j.issues.get('OXE-20').fields.description = adf('Editado pelo PO depois da coleta.');
    const out = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV });
    assert.match(out.results[0].error, /mudou depois da coleta/);
    assert.equal(j.calls.filter((c) => c.method === 'PUT').length, 0);
    const forced = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV, confirmOverwrite: true });
    assert.equal(forced.results[0].applied, true);
  });

  it('a spec that fails the lint is not applied', async () => {
    const { dir, j } = await ready();
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY().replace('- Enviar arquivos e imagens.', '- A confirmar'));
    const out = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http: j.http, env: ENV });
    assert.match(out.results[0].error, /reprovado no lint/);
  });
});

describe('alm.ready_gate (Definition of Ready)', () => {
  it('an item without spec-v1 does not go to in_progress (stays pending, with the reason); with it, it moves', async () => {
    const cfg = alm.almConfig({ alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, ready_gate: true, states: { in_progress: 'Em andamento' } } });
    const dir = project();
    const pdir = path.join(dir, '.oxe', 'program');
    alm.addLink(pdir, { ref: 'F1-T1', key: 'OXE-20' });
    const j = fakeJira();
    const statuses = ['A fazer', 'Em andamento'];
    const http = async (method, url, headers, body) => {
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(new URL(url).pathname);
      if (m && method === 'GET') return { status: 200, json: { transitions: statuses.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
      if (m && method === 'POST') { j.issues.get(m[1]).fields.status = { name: statuses[Number(body.transition.id) - 1] }; return { status: 204, json: null }; }
      return j.http(method, url, headers, body);
    };
    const ev = [{ type: 'TaskStarted', work_item_id: 'T1' }];
    const r = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http, env: ENV, sleep: async () => {} });
    assert.ok(r.skipped.some((s) => /Definition of Ready: OXE-20 sem o rótulo spec-v1/.test(s.why)));
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'A fazer');
    j.issues.get('OXE-20').fields.labels.push('spec-v1');
    const r2 = await alm.sync(pdir, cfg, ev, { phase: 'F1' }, { http, env: ENV, sleep: async () => {} });
    assert.equal(r2.moved.length, 1, 'the pending move goes once the card is refined');
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Em andamento');
  });
});

describe('alm refine moves its own stages (12-column board)', () => {
  const STATES = { intake: 'Backlog', grooming: 'Em grooming', refinement: 'Em refinamento', ready: 'Pronto para desenvolvimento', in_progress: 'Em desenvolvimento' };
  const withTransitions = (j) => {
    const names = ['Backlog', ...Object.values(STATES).slice(1)];
    return async (method, url, headers, body) => {
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(new URL(url).pathname);
      if (m && method === 'GET') return { status: 200, json: { transitions: names.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
      if (m && method === 'POST') { j.issues.get(m[1]).fields.status = { name: names[Number(body.transition.id) - 1] }; return { status: 204, json: null }; }
      return j.http(method, url, headers, body);
    };
  };
  it('--claim → Em refinamento; apply with open questions → back to Em grooming; with none → Pronto para desenvolvimento', async () => {
    const dir = project({ states: STATES, track: ['grooming', 'refinement', 'ready', 'in_progress'] });
    const j = fakeJira();
    j.issues.get('OXE-20').fields.status = { name: 'Backlog' };
    const http = withTransitions(j);
    await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], claim: true, http, env: ENV });
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Em refinamento');
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY());
    const r = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http, env: ENV });
    assert.equal(r.results[0].moved.stage, 'grooming', 'one open question → grooming');
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Em grooming');
    // answered: no question left → ready
    const dir2 = project({ states: STATES, track: ['grooming', 'refinement', 'ready', 'in_progress'] });
    const k = fakeJira();
    k.issues.get('OXE-20').fields.status = { name: 'Em refinamento' };
    const http2 = withTransitions(k);
    await op.runtimeAlmRefine(dir2, null, { action: 'collect', keys: ['OXE-20'], http: http2, env: ENV });
    fs.writeFileSync(path.join(dir2, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY().replace('- A confirmar', '- Perda da fila offline ao fechar o app (comentário de 12/11)').replace('- Qual o risco aceito para perda da fila offline ao fechar o app?', '- (nenhuma)'));
    const r2 = await op.runtimeAlmRefine(dir2, null, { action: 'apply', keys: ['OXE-20'], http: http2, env: ENV });
    assert.equal(r2.results[0].moved.stage, 'ready');
    assert.equal(k.issues.get('OXE-20').fields.status.name, 'Pronto para desenvolvimento');
    assert.ok(!k.issues.get('OXE-20').fields.labels.includes('needs-info'));
  });
});

describe('alm refine import: CA-n ↔ A-n explicit both ways', () => {
  function withSpec() {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), ['# SPEC', '', '## Critérios de aceite', '', '| ID | Critério | Risco | Como verificar |', '|---|---|---|---|', '| A1 | envia o texto (OXE-20) | P1 | e2e/send.spec.ts |', '| A2 | outro critério | P2 | x |', ''].join('\n'));
    fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'refine'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-20.json'), JSON.stringify({ key: 'OXE-20', kind: 'story', description_hash: 'x', description: '' }));
    const md = GOOD_STORY().replace('1. **CA-1** — Dado um celular pareado', '1. **CA-1 (A1)** — Dado um celular pareado')
      .replace('· Teste: e2e/send.spec.ts › fila offline', '· Teste: e2e/send.spec.ts › fila offline · Risco: P1')
      + '\n';
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), md);
    return dir;
  }

  it('a CA without SPEC id becomes A-n (text cites the card, test → Como verificar, Risco → Risco) and gets (A-n) written back', () => {
    const dir = withSpec();
    const out = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-20'], by: 'po' });
    const r = out.results[0];
    assert.deepEqual(r.added.map((a) => [a.ca, a.a]), [['CA-2', 'A3']]);
    assert.deepEqual(r.linked, [{ ca: 'CA-1', a: 'A1' }]);
    assert.deepEqual(r.problems, []);
    const spec = fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8');
    assert.match(spec, /\| A3 \| Dado o celular offline.*\(OXE-20\) \| P1 \| e2e\/send\.spec\.ts › fila offline \|/);
    const md = fs.readFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), 'utf8');
    assert.match(md, /\*\*CA-2 \(A3\)\*\*/);
    assert.deepEqual(refine.parseCriteria(md).map((c) => [c.id, c.spec_id, c.risk]), [['CA-1', 'A1', null], ['CA-2', 'A3', 'P1']]);
    // rerun: nothing more to add, both linked
    const again = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-20'], by: 'po' });
    assert.deepEqual(again.results[0].added, []);
    assert.equal(again.results[0].linked.length, 2);
  });

  it('problems: a CA pointing at a missing A, an A that does not cite the card, no risk where the SPEC has the column; --dry-run writes nothing', () => {
    const dir = withSpec();
    const f = path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('**CA-1 (A1)**', '**CA-1 (A9)**').replace(' · Risco: P1', ''));
    const before = fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8');
    const out = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-20'], dryRun: true });
    assert.ok(out.results[0].problems.some((p) => /CA-1 aponta para A9, que não existe/.test(p)));
    assert.ok(out.results[0].problems.some((p) => /CA-2: .*informe --risk/.test(p)));
    assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8'), before);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('**CA-1 (A9)**', '**CA-1 (A2)**'));
    const o2 = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-20'], dryRun: true, risk: 'P2' });
    assert.ok(o2.results[0].problems.some((p) => /A2 \(de CA-1\) não cita OXE-20/.test(p)));
  });

  it('lint with a program SPEC: a CA without (A-n) is a warning; one pointing at a missing A is an error', async () => {
    const dir = withSpec();
    const out = await op.runtimeAlmRefine(dir, null, { action: 'lint', keys: ['OXE-20'] });
    // one line for every CA not linked yet (OxeSpace 15/11: one warning per CA was noise before the import)
    assert.ok(out.results[0].warnings.some((w) => /CA\(s\) ainda sem critério da SPEC \([^)]*CA-2/.test(w)), out.results[0].warnings.join('\n'));
    assert.equal(out.results[0].warnings.filter((w) => /sem critério da SPEC/.test(w)).length, 1);
    const f = path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('**CA-1 (A1)**', '**CA-1 (A9)**'));
    const bad = await op.runtimeAlmRefine(dir, null, { action: 'lint', keys: ['OXE-20'] });
    assert.equal(bad.results[0].ok, false);
    assert.ok(bad.results[0].errors.some((e) => /CA-1 aponta para A9/.test(e)));
  });
});

describe('alm refine import respects frozen phases (executing / closed)', () => {
  function withProgram(status, extra = {}) {
    const dir = project();
    fs.writeFileSync(path.join(dir, '.oxe', 'STATE.md'), '# STATE\n');
    fs.writeFileSync(path.join(dir, '.oxe', 'SPEC.md'), ['# SPEC', '', '## Critérios de aceite', '', '| ID | Critério | Risco | Como verificar |', '|---|---|---|---|', '| A1 | Dado um celular pareado, quando o operador envia um texto de até 4000 caracteres, então ele aparece no celular em até 2 s (OXE-20) | P1 | e2e/send.spec.ts |', ''].join('\n'));
    fs.mkdirSync(path.join(dir, '.oxe', 'program'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'program', 'PROGRAM.json'), JSON.stringify({ schema_version: 1, active_phase: 'F1', phases: [{ id: 'F1', status, acceptance: ['A1'], ...extra }, { id: 'F2', status: 'pending', acceptance: [] }] }));
    fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'refine'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.oxe', 'alm', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'refine', 'OXE-20.json'), JSON.stringify({ key: 'OXE-20', kind: 'story' }));
    fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY().replace('**CA-1**', '**CA-1 (A1)**').replace('em até 2 s', 'em até 1 s').replace('· Teste: e2e/send.spec.ts › fila offline', '· Teste: e2e/send.spec.ts › fila offline · Risco: P1'));
    return dir;
  }

  it('--phase of an executing or closed phase: refused, nothing written, the CR command printed instead', () => {
    for (const status of ['executing', 'closed']) {
      const dir = withProgram(status);
      const before = fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8');
      const out = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-20'], phase: 'F1', by: 'po' });
      assert.equal(out.refused, true, status);
      assert.match(out.reason, new RegExp(`F1 está ${status}.*congelados`));
      assert.ok(out.commands.some((c) => /runtime feedback --class new_scope/.test(c)));
      assert.equal(fs.readFileSync(path.join(dir, '.oxe', 'SPEC.md'), 'utf8'), before, 'SPEC untouched');
      assert.ok(!fs.existsSync(path.join(dir, '.oxe', 'program', 'changes.ndjson')));
    }
    // a pending phase takes them
    const ok = withProgram('executing');
    const r = op.runtimeAlmRefineImport(ok, null, { keys: ['OXE-20'], phase: 'F2', by: 'po' });
    assert.ok(!r.refused);
    assert.deepEqual(r.results[0].added.map((a) => a.ca), ['CA-2']);
  });

  it('a CA that changes an A of a frozen phase becomes a CR proposal (amend-to vN), never a spec edit', () => {
    const dir = withProgram('executing');
    const out = op.runtimeAlmRefineImport(dir, null, { keys: ['OXE-20'], by: 'po', dryRun: true });
    const p = out.results[0].proposals[0];
    assert.equal(p.a, 'A1');
    assert.equal(p.frozen, true);
    assert.match(p.command, /runtime feedback --class spec_gap --criteria A1 --amend-to <N>/);
    assert.match(p.why, /fase F1 \(executing\).*versão nova/);
    // the same change on a phase not started yet is a spec amend proposal
    const free = withProgram('pending');
    const q = op.runtimeAlmRefineImport(free, null, { keys: ['OXE-20'], by: 'po', dryRun: true }).results[0].proposals[0];
    assert.equal(q.frozen, false);
    assert.match(q.command, /^oxe-cc spec amend A1 --text/);
  });
});

describe('refine never moves a card that is already Ready or past it', () => {
  const STATES12 = { intake: 'Backlog', grooming: 'Em grooming', refinement: 'Em refinamento', ready: 'Pronto para desenvolvimento', in_progress: 'Em desenvolvimento', review: 'Em revisão', verified: 'Testado', queued: 'Na fila', integrated: 'Na main', staging: 'Em homologação', accepted: 'Homologado', released: 'Lançado' };
  const names = Object.values(STATES12);
  const withTransitions = (j, posts) => async (method, url, headers, body) => {
    const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(new URL(url).pathname);
    if (m && method === 'GET') return { status: 200, json: { transitions: names.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
    if (m && method === 'POST') { posts.push(m[1]); j.issues.get(m[1]).fields.status = { name: names[Number(body.transition.id) - 1] }; return { status: 204, json: null }; }
    return j.http(method, url, headers, body);
  };
  for (const col of ['Pronto para desenvolvimento', 'Em desenvolvimento', 'Em revisão', 'Testado', 'Na fila', 'Na main', 'Em homologação', 'Homologado', 'Lançado']) {
    it(`a card in "${col}": --claim and apply write the spec, spec-v1 and the original comment, with no transition`, async () => {
      const dir = project({ states: STATES12, track: ['grooming', 'refinement', 'ready', 'in_progress'] });
      const j = fakeJira();
      j.issues.get('OXE-20').fields.status = { name: col };
      const posts = [];
      const http = withTransitions(j, posts);
      const c = await op.runtimeAlmRefine(dir, null, { action: 'collect', keys: ['OXE-20'], claim: true, http, env: ENV });
      assert.equal(c.results[0].moved.skipped, true);
      fs.writeFileSync(path.join(dir, '.oxe', 'alm', 'specs', 'OXE-20.md'), GOOD_STORY().replace('- Qual o risco aceito para perda da fila offline ao fechar o app?', '- (nenhuma)').replace('- A confirmar', '- nenhum risco novo (card)'));
      const r = await op.runtimeAlmRefine(dir, null, { action: 'apply', keys: ['OXE-20'], http, env: ENV });
      assert.equal(r.results[0].applied, true);
      assert.equal(r.results[0].moved.skipped, true);
      assert.deepEqual(posts, [], 'no transition at all');
      assert.equal(j.issues.get('OXE-20').fields.status.name, col);
      assert.ok(j.issues.get('OXE-20').fields.labels.includes('spec-v1'));
      assert.ok(j.issues.get('OXE-20').fields.comment.comments.some((cm) => /Texto original/.test(refine.adfToText(cm.body))));
    });
  }
});

describe('grooming of a card (grill --card) → the card comment and the quality report', () => {
  it('questions and answers with their source go to one "Grooming (OXE)" comment (in place); the card moves only from the Backlog; the report measures input and output', async () => {
    const dir = project({ states: { intake: 'Backlog', grooming: 'Em grooming', refinement: 'Em refinamento', ready: 'Pronto para desenvolvimento' }, track: ['grooming', 'refinement', 'ready'] });
    const g = (action, o = {}) => op.runtimeGrill(dir, null, { action, card: 'OXE-20', ...o });
    g('start', { type: 'bugfix' });
    g('fact', { branch: 'problem', text: 'o filtro troca /resume por …', source: 'card' });
    const q2 = g('ask', { branch: 'scope', question: 'Comandos com dois segmentos também passam?', recommended: 'não, só um segmento' });
    const q3 = g('ask', { branch: 'risks', question: 'Qual a prioridade?', recommended: 'alta' });
    const q4 = g('ask', { branch: 'edges', question: 'E um caminho como /opt?', recommended: 'continua escondido' });
    g('answer', { id: q2.id, choice: 'ok', source: 'decisão registrada do usuário: sessão do celular, 12/11' });
    g('answer', { id: q3.id, text: 'alta (prio-a)', source: 'coordenação: o card tem o rótulo prio-a' });
    g('defer', { id: q4.id, reason: 'sem base: fica para o usuário' });
    const dry = await op.runtimeGrooming(dir, null, { action: 'publish', card: 'OXE-20' });
    assert.match(dry.text, /OXE-20\/Q-2 \(scope\) Comandos com dois segmentos/);
    assert.match(dry.text, /Resposta: não, só um segmento \[decisão registrada do usuário: sessão do celular, 12\/11\]/);
    const j = fakeJira();
    j.issues.get('OXE-20').fields.status = { name: 'Backlog' };
    const names = ['Backlog', 'Em grooming', 'Em refinamento', 'Pronto para desenvolvimento'];
    const comments = [];
    const http = async (method, url, headers, body) => {
      const p = new URL(url).pathname;
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/.exec(p);
      if (m && method === 'GET') return { status: 200, json: { transitions: names.map((s, i) => ({ id: String(i + 1), name: s, to: { name: s } })) } };
      if (m && method === 'POST') { j.issues.get(m[1]).fields.status = { name: names[Number(body.transition.id) - 1] }; return { status: 204, json: null }; }
      const c = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment(?:\/(\d+))?$/.exec(p);
      if (c && method === 'GET') return { status: 200, json: { comments } };
      if (c && method === 'POST') { comments.push({ id: String(comments.length + 1), body: body.body }); return { status: 201, json: {} }; }
      if (c && method === 'PUT') { comments.find((x) => x.id === c[2]).body = body.body; return { status: 200, json: {} }; }
      return j.http(method, url, headers, body);
    };
    const pub = await op.runtimeGrooming(dir, null, { action: 'publish', card: 'OXE-20', apply: true, http, env: ENV });
    assert.equal(pub.published, true);
    assert.equal(j.issues.get('OXE-20').fields.status.name, 'Em grooming');
    await op.runtimeGrooming(dir, null, { action: 'publish', card: 'OXE-20', apply: true, http, env: ENV });
    assert.equal(comments.length, 1, 'updated in place');
    const rep = await op.runtimeGrooming(dir, null, { action: 'report' });
    const row = rep.rows.find((r) => r.key === 'OXE-20');
    assert.deepEqual([row.questions, row.facts_from_card, row.answered_by_user_decision, row.answered_by_coordination, row.no_basis], [3, 1, 1, 1, 1]);
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'alm', 'grill', 'grooming-quality.md')));
  });
});
