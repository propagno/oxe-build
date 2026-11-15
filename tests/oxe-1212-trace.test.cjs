'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const op = require('../bin/lib/oxe-operational.cjs');
const alm = require('../bin/lib/oxe-alm.cjs');

// 1.21.2 — oxe-cc trace: one reference per child, the reverse derived, every loose end listed with its fix, and the
// "Documentos (OXE)" comment of each card upserted (story → PRD, criteria with evidence, decisions → ADR).

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token', OXE_ALM_WRITER: 'w' };

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-trace-'));
  dirs.push(dir);
  write(dir, '.oxe/STATE.md', '# STATE\n');
  write(dir, '.oxe/config.json', JSON.stringify({ alm: { provider: 'jira', program: 'p', jira: { project: 'OXE' }, writer: 'w', stories_source: 'alm', docs: { repo: 'https://github.com/o/r', branch: 'main' } } }));
  write(dir, '.oxe/SPEC.md', ['# SPEC', '', '## Requisitos', '', '| R-ID | Requisito | Versão | Critério de aceite |', '|---|---|---|---|', '| R1 | enviar | v1 | A1, A2 |', '| R2 | status | v1 | A3 |', '',
    '## Critérios de aceite', '', '| ID | Critério | Risco | Como verificar |', '|---|---|---|---|',
    '| A1 | envia o texto (OXE-20) | P1 | e2e/send.spec.ts |', '| A2 | fila offline (OXE-20) | P2 | e2e/send.spec.ts |', '| A3 | mostra o status | P2 | vitest |', ''].join('\n'));
  write(dir, '.oxe/PRD.md', ['# PRD — Envio', '', '## Histórias de usuário', '', '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |', '|---|---|---|---|---|---|---|',
    '| US-1 | operador | enviar (OXE-20) | não digitar | R1 | A1, A2 | Must |', '| US-2 | operador | ver o status | saber | R2 | | Should |', ''].join('\n'));
  write(dir, '.oxe/PLAN.json', JSON.stringify({ schema_version: 1, phase: 'F1', tasks: [{ id: 'T1', title: 'enviar', acceptance: ['A1', 'A2'], decisions: ['D-01'] }], acceptance_tests: [{ criterion: 'A1', files: ['e2e/send.spec.ts'] }] }));
  write(dir, '.oxe/program/decisions.ndjson', [
    JSON.stringify({ kind: 'decision', id: 'D-01', title: 'fila local com retry', criteria: ['A2'], stories: [], status: 'active' }),
    JSON.stringify({ kind: 'decision', id: 'D-02', title: 'decisão solta', criteria: [], status: 'active' }),
  ].join('\n') + '\n');
  write(dir, '.oxe/alm/specs/OXE-20.md', '# OXE-20\n\n## Critérios de aceite\n\n1. **CA-1 (A1)** — Dado x, quando y, então z · Teste: e2e/send.spec.ts\n');
  write(dir, '.oxe/program/changes.ndjson', `${JSON.stringify({ kind: 'cr', id: 'CR-1', class: 'defect', status: 'open', criteria: ['A1'], summary: 'cai offline', at: 'x' })}\n`);
  alm.addLink(path.join(dir, '.oxe', 'program'), { ref: 'US-1', key: 'OXE-20', kind: 'story' });
  alm.addLink(path.join(dir, '.oxe', 'program'), { ref: 'F1-T1', key: 'OXE-30', kind: 'task' });
  return dir;
}

describe('trace: v1 criteria of OTHER phases are not the current plan to test (OxeSpace 15/11, OxeCode F5 close)', () => {
  it('with phaseCriteria, only the active phase criteria are asked for a test or a task', () => {
    const trace = require('../bin/lib/oxe-trace.cjs');
    const snap = {
      stories: [], criteria: [{ id: 'A8', text: 'f3' }, { id: 'A19', text: 'f5' }],
      requirements: [{ id: 'R1', version: 'v1', criteria: ['A8', 'A19'] }],
      decisions: [], rfcs: [], tasks: [{ id: 'T1', acceptance: [] }], tests: [], changes: [], links: new Map(),
      cardSpecs: new Map(), checks: [], phase: 'F5', almConfigured: false, storiesSource: 'prd', cardKeysOf: () => [],
    };
    const ids = (s) => trace.build(s).orphans.filter((o) => /critério v1 sem teste/.test(o.why)).map((o) => o.id).sort();
    assert.deepEqual(ids(snap), ['A19', 'A8'], 'without a program: every v1 criterion');
    assert.deepEqual(ids({ ...snap, phaseCriteria: ['A19'] }), ['A19'], 'with the active phase: only its own');
  });
});

describe('oxe-cc trace: the graph and its loose ends', () => {
  it('derives the reverse links (story → decisions through the shared criterion) and lists every orphan with its fix', async () => {
    const dir = project();
    const g = await op.runtimeTrace(dir, null, {});
    const us1 = g.stories.find((s) => s.id === 'US-1');
    assert.equal(us1.card, 'OXE-20');
    assert.deepEqual(us1.decisions.map((d) => d.id), ['D-01'], 'US-1 reaches D-01 through A2');
    const a1 = g.criteria.find((c) => c.id === 'A1');
    assert.deepEqual(a1.cards, ['OXE-20']);
    assert.deepEqual(a1.tests, ['e2e/send.spec.ts']);
    assert.deepEqual(a1.changes, ['CR-1']);
    const why = g.orphans.map((o) => `${o.kind} ${o.id}: ${o.why}`);
    assert.ok(why.some((w) => /story US-2: história sem critério/.test(w)));
    assert.ok(why.some((w) => /story US-2: história sem card no ALM/.test(w)));
    assert.ok(why.some((w) => /criterion A3: critério sem história/.test(w)));
    assert.ok(why.some((w) => /criterion A3: critério v1 sem teste/.test(w)));
    assert.ok(why.some((w) => /decision D-02: decisão sem critério nem história/.test(w)));
    assert.ok(why.some((w) => /criterion A2: cita OXE-20, mas nenhum CA do card refinado aponta para A2/.test(w)));
    assert.ok(why.some((w) => /change CR-1: CR de defeito sem bug no ALM/.test(w)));
    assert.ok(g.orphans.every((o) => o.fix), 'every orphan carries its fix');
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'trace.json')));
  });

  it('a bug linked to its CR (alm defect --cr) ties the defect: neither "CR sem bug" nor "bug sem CR"', async () => {
    const dir = project();
    alm.addLink(path.join(dir, '.oxe', 'program'), { ref: 'BUG-1', key: 'OXE-99', kind: 'bug', cr: 'CR-1' });
    const g = await op.runtimeTrace(dir, null, {});
    assert.ok(!g.orphans.some((o) => /CR de defeito sem bug|sem CR/.test(o.why)));
  });

  it('alm link <ref> <key> --cr keeps the bug a bug and writes the CR; a known CI failure is no "bug sem CR" (OxeSpace 14/11)', async () => {
    const dir = project();
    const programDir = path.join(dir, '.oxe', 'program');
    alm.addLink(programDir, { ref: 'FLAKY-F6-FOCUS', key: 'OXE-135', kind: 'bug', intake: true });
    let g = await op.runtimeTrace(dir, null, {});
    assert.ok(g.orphans.some((o) => /bug FLAKY-F6-FOCUS sem CR/.test(o.why)));
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'link', ref: 'FLAKY-F6-FOCUS', key: 'OXE-135', cr: 'CR-9', env: ENV }), /CR-9: CR inexistente/);
    const out = await op.runtimeAlm(dir, null, { action: 'link', ref: 'FLAKY-F6-FOCUS', key: 'OXE-135', cr: 'CR-1', env: ENV });
    assert.deepEqual([out.kind, out.cr], ['bug', 'CR-1']);
    const rec = alm.links(programDir).get('FLAKY-F6-FOCUS');
    assert.deepEqual([rec.kind, rec.cr, rec.intake], ['bug', 'CR-1', true], 'kind and fields kept, CR written');
    // the record the old link wrote (task, no intake): --kind bug brings it back, the intake flag from the history
    alm.addLink(programDir, { ref: 'FLAKY-F6-FOCUS', key: 'OXE-135', kind: 'task', manual: true });
    const fixed = await op.runtimeAlm(dir, null, { action: 'link', ref: 'FLAKY-F6-FOCUS', key: 'OXE-135', kind: 'bug', cr: 'CR-1', env: ENV });
    assert.equal(fixed.kind, 'bug');
    const rec2 = alm.links(programDir).get('FLAKY-F6-FOCUS');
    assert.deepEqual([rec2.kind, rec2.cr, rec2.intake], ['bug', 'CR-1', true]);
    await assert.rejects(op.runtimeAlm(dir, null, { action: 'link', ref: 'FLAKY-F6-FOCUS', key: 'OXE-135', kind: 'nope', env: ENV }), /--kind nope/);
    // a bug tracked as a known CI failure needs no CR
    const dir2 = project();
    alm.addLink(path.join(dir2, '.oxe', 'program'), { ref: 'FLAKY-X', key: 'OXE-140', kind: 'bug' });
    require('../bin/lib/oxe-known-failures.cjs').add(path.join(dir2, '.oxe', 'program'), { pattern: 'terminal-focus-exit.spec.ts:35', item: 'OXE-140' });
    g = await op.runtimeTrace(dir2, null, {});
    assert.ok(!g.orphans.some((o) => /bug FLAKY-X sem CR/.test(o.why)));
  });

  it('publish: dry run shows the comment; --apply upserts one "Documentos (OXE)" per card (updated in place on rerun)', async () => {
    const dir = project();
    const dry = await op.runtimeTrace(dir, null, { action: 'publish' });
    const story = dry.publish.find((p) => p.key === 'OXE-20');
    assert.match(story.text, /História: US-1 — https:\/\/github\.com\/o\/r\/blob\/main\/docs\/product\/PRD\.md/);
    assert.match(story.text, /- A1 · sem execução · teste e2e\/send\.spec\.ts · CR CR-1/);
    assert.match(story.text, /- D-01 — fila local com retry/);
    const comments = new Map();
    let id = 0;
    const calls = [];
    const http = async (method, url, headers, body) => {
      calls.push(method);
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment(?:\/(\d+))?$/.exec(new URL(url).pathname);
      if (m && method === 'GET') return { status: 200, json: { comments: comments.get(m[1]) || [] } };
      if (m && method === 'POST') { comments.set(m[1], [...(comments.get(m[1]) || []), { id: String((id += 1)), body: body.body }]); return { status: 201, json: {} }; }
      if (m && method === 'PUT') { const c = comments.get(m[1]).find((x) => x.id === m[2]); c.body = body.body; return { status: 200, json: {} }; }
      return { status: 404, json: null, text: 'no' };
    };
    await assert.rejects(op.runtimeTrace(dir, null, { action: 'publish', apply: true, http, env: { ...ENV, OXE_ALM_WRITER: 'outra' } }), /só leitura/);
    const a = await op.runtimeTrace(dir, null, { action: 'publish', apply: true, http, env: ENV });
    assert.deepEqual(a.published.map((p) => [p.key, p.updated]).sort(), [['OXE-20', false], ['OXE-30', false]]);
    const b = await op.runtimeTrace(dir, null, { action: 'publish', apply: true, http, env: ENV });
    assert.ok(b.published.every((p) => p.updated), 'second run updates in place');
    assert.equal(comments.get('OXE-20').length, 1, 'one comment per card');
  });

  it('the ADR lists each story with its card key (decisions → stories → cards)', () => {
    const dir = project();
    write(dir, '.oxe/program/decisions.ndjson', `${JSON.stringify({ kind: 'decision', id: 'D-03', title: 'escala única de tamanhos', criteria: ['A1'], stories: ['US-1'], status: 'active' })}\n`);
    op.runtimeDecision(dir, null, { action: 'publish' });
    const adr = fs.readdirSync(path.join(dir, 'docs', 'adr')).filter((f) => /^D-03/.test(f)).map((f) => fs.readFileSync(path.join(dir, 'docs', 'adr', f), 'utf8'))[0];
    assert.match(adr, /\*\*Histórias:\*\* US-1 \(OXE-20\)/);
  });
});

describe('alm.trace_gate', () => {
  const setGate = (dir, mode) => {
    const f = path.join(dir, '.oxe', 'config.json');
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    c.alm.trace_gate = mode;
    fs.writeFileSync(f, JSON.stringify(c));
  };
  it('"close": warnings in spec check / plan lint, errors at the close; "strict": errors everywhere; unset: nothing', () => {
    const dir = project();
    assert.deepEqual(op.traceGateFindings(dir, null, 'close'), { errors: [], warnings: [], mode: null });
    setGate(dir, 'close');
    const spec = op.traceGateFindings(dir, null, 'spec');
    assert.equal(spec.errors.length, 0);
    assert.ok(spec.warnings.some((w) => /^rastreabilidade: story US-2: história sem critério: .* — ligue a US/.test(w)));
    assert.ok(op.traceGateFindings(dir, null, 'close').errors.length > 0, 'the close blocks');
    const sc = op.runtimeSpecCheck(dir, null, { fast: true });
    assert.ok(sc.warnings.some((w) => /^rastreabilidade:/.test(w)));
    setGate(dir, 'strict');
    assert.ok(op.traceGateFindings(dir, null, 'plan').errors.length > 0);
    assert.equal(op.runtimeSpecCheck(dir, null, { fast: true }).ok, false);
  });
});
