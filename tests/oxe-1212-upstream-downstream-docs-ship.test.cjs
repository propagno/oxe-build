'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const prdLib = require('../bin/lib/oxe-prd.cjs');
const grillLib = require('../bin/lib/oxe-grill.cjs');
const rfcLib = require('../bin/lib/oxe-rfc.cjs');
const decisionsLib = require('../bin/lib/oxe-decisions.cjs');
const docsPublishLib = require('../bin/lib/oxe-docs-publish.cjs');
const adrLib = require('../bin/lib/oxe-adr.cjs');
const docsCheckLib = require('../bin/lib/oxe-docs-check.cjs');
const shipPrLib = require('../bin/lib/oxe-ship-pr.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkDir(prefix = 'oxe-1212-r10-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

describe('Round 10 — PRD traceability, escaped pipes, subcriteria & Azure AB# cards', () => {
  it('parses subcriteria (A19.1), bold IDs, escaped pipes \\|, ignores HTML comments/fences, and extracts AB#123', () => {
    const md = [
      '---',
      'version: 3',
      'status: aprovado',
      '---',
      '',
      '<!--',
      '## Histórias de usuário',
      '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
      '| US-99 | fantasma | x | y | R99 | A99 | Must |',
      '-->',
      '',
      '## Histórias de usuário',
      '',
      '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
      '|---|---|---|---|---|---|---|',
      '| **US-1** | operador | filtrar `a \\| b` (AB#451, OXE-77) | rapidez | **R1**, R-RB-02 | **A19.1**, A19.2, G1 | Must |',
      '',
    ].join('\n');

    const parsed = prdLib.parsePrd(md);
    assert.equal(parsed.stories.length, 1);
    assert.equal(parsed.stories[0].id, 'US-1');
    assert.match(parsed.stories[0].want, /filtrar `a \| b`/);
    assert.deepEqual(parsed.stories[0].cards, ['AB#451', 'OXE-77']);
    assert.deepEqual(parsed.stories[0].requirements, ['R1', 'R-RB-02']);
    assert.deepEqual(parsed.stories[0].criteria, ['A19.1', 'A19.2', 'G1']);
  });

  it('lintPrd treats G* as non-orphan and reconciles parent A19 <-> subcriteria A19.1, A19.2 in both directions', () => {
    const prdWithSubs = prdLib.parsePrd([
      '## Histórias de usuário',
      '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
      '|---|---|---|---|---|---|---|',
      '| US-1 | dev | sub | valor | R1 | A19.1, A19.2 | Must |',
    ].join('\n'));
    const r1 = prdLib.lintPrd(prdWithSubs, {
      criteria: ['A19', 'A19.1', 'A19.2', 'G1'],
      requirements: ['R1'],
      required: true,
    });
    assert.deepEqual(r1, { errors: [], warnings: [] });

    const prdWithParent = prdLib.parsePrd([
      '## Histórias de usuário',
      '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
      '|---|---|---|---|---|---|---|',
      '| US-1 | dev | pai | valor | R1 | A19 | Must |',
    ].join('\n'));
    const r2 = prdLib.lintPrd(prdWithParent, {
      criteria: ['A19.1', 'A19.2', 'G2'],
      requirements: ['R1'],
      required: true,
    });
    assert.deepEqual(r2, { errors: [], warnings: [] });

    const prdPartialSub = prdLib.parsePrd([
      '## Histórias de usuário',
      '| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |',
      '|---|---|---|---|---|---|---|',
      '| US-1 | dev | parcial | valor | R1 | A19.1 | Must |',
    ].join('\n'));
    const r3 = prdLib.lintPrd(prdPartialSub, {
      criteria: ['A19.1', 'A19.2'],
      requirements: ['R1'],
    });
    assert.ok(r3.warnings.some((w) => /sem história de usuário no PRD: A19\.2/.test(w)));
  });
});

describe('Round 10 — Grill restart replay & Glossary pipe/$ roundtrip', () => {
  it('replay resets prior questions/terms/confirmations when grill restarts (--restart) while keeping seq monotonic', () => {
    const dir = mkDir();
    const gdir = grillLib.dirFor(path.join(dir, '.oxe', 'SPEC.md'));
    grillLib.start(gdir, { type: 'feature', title: 'Sessão 1' });
    const q1 = grillLib.ask(gdir, { branch: 'problem', question: 'Pergunta antiga?', recommended: 'sim', why: 'padrão' });
    grillLib.answer(gdir, q1.id, { choice: 'ok' });
    grillLib.term(gdir, { term: 'Antigo', definition: 'velho', synonyms: ['old'] });
    grillLib.confirm(gdir, 'problem', { playback: 'resumo do ramo confirmado pelo usuário' });

    grillLib.start(gdir, { type: 'refactor', title: 'Sessão 2', restart: true });
    const st = grillLib.status(gdir);
    assert.equal(st.type, 'refactor');
    assert.equal(st.title, 'Sessão 2');
    assert.equal(st.questions.length, 0);
    assert.equal(st.terms.length, 0);
    assert.equal(st.branches.find((b) => b.id === 'problem').confirmed, false);

    const q2 = grillLib.ask(gdir, { branch: 'scope', question: 'Nova pergunta?', recommended: 'escopo mínimo', why: 'baixo risco' });
    assert.equal(q2.id, 'Q-2', 'seq stays monotonic across restarts');
  });

  it('writeGlossary and readGlossary preserve pipes (|) and dollar signs ($&, US$ 10) without corrupting columns', () => {
    const dir = mkDir();
    const gfile = path.join(dir, '.oxe', 'GLOSSARY.md');
    const terms = [
      { term: ' Canal ', definition: 'Pipe `a | b` com taxa US$ 10 ($& literal)', synonyms: ['stream', 'fila'], source: 'grill' },
    ];
    // First write creates file; second write replaces existing marker block.
    grillLib.writeGlossary(gfile, [{ term: 'Temp', definition: 'inicial', synonyms: [] }]);
    fs.appendFileSync(gfile, '\nNota manual fora do bloco.\n', 'utf8');
    grillLib.writeGlossary(gfile, terms);

    const raw = fs.readFileSync(gfile, 'utf8');
    assert.match(raw, /Nota manual fora do bloco\./);
    assert.match(raw, /US\$ 10 \(\$&\s*literal\)/);

    const back = grillLib.readGlossary(gfile);
    assert.equal(back.length, 1);
    assert.equal(back[0].term, 'Canal');
    assert.equal(back[0].definition, 'Pipe `a | b` com taxa US$ 10 ($& literal)');
    assert.deepEqual(back[0].synonyms, ['stream', 'fila']);
  });
});

describe('Round 10 — RFC :: alternatives, $ replacement, subphases & subcriteria risk gate', () => {
  it('accepts RFC in dotted subphase F2.1 with $ in title and :: in rejected alternatives without throwing or mangling', () => {
    const dir = mkDir();
    write(dir, '.oxe/SPEC.md', '# SPEC\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    const created = op.runtimeRfc(dir, null, {
      action: 'new',
      title: 'Custo US$ 10 ($& seguro)',
      phase: 'F2.1',
      by: 'arquiteto',
    });
    assert.equal(created.id, 'RFC-F2.1-1');

    const full = path.join(dir, created.file);
    let txt = fs.readFileSync(full, 'utf8');
    assert.match(txt, /# RFC-F2\.1-1 — Custo US\$ 10 \(\$&\s*seguro\)/);
    txt = txt
      .replace('(O problema técnico, ligado às histórias e critérios: US-n, R*, A*.)', 'Atender A19.1 e US-1.')
      .replace('(Desenho escolhido: componentes, contratos, dados, fluxo. Diagrama se ajudar.)', 'Usar fila tipada.')
      .replace('- **(alternativa)** — (por que foi recusada)', '- **Usar std::vector ou pseudo ::before** — acoplamento nativo C++::ABI')
      .replace('- (nenhuma — apague esta linha quando não houver)', '');
    fs.writeFileSync(full, txt, 'utf8');

    const acc = op.runtimeRfc(dir, null, { action: 'accept', id: 'RFC-F2.1-1', by: 'arquiteto' });
    assert.equal(acc.decision, 'D-F2.1-1');

    const stored = decisionsLib.list(path.join(dir, '.oxe', 'program'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].alternatives[0].text, 'Usar std::vector ou pseudo ::before');
    assert.equal(stored[0].alternatives[0].reason, 'acoplamento nativo C++::ABI');
    assert.equal(stored[0].alternatives[0].by, 'arquiteto');
    assert.deepEqual(stored[0].criteria, ['A19.1']);
  });

  it('lintPhaseRfc detects P0/P1 subcriteria under parent phase criterion and honors accepted global RFC citing them', () => {
    const dir = mkDir();
    write(dir, '.oxe/SPEC.md', '# SPEC\n');
    write(dir, '.oxe/STATE.md', '# STATE\n');
    const risks = new Map([['A19.1', 'P0'], ['A19.2', 'P3']]);

    const before = rfcLib.lintPhaseRfc(dir, { phase: 'F2', phaseCriteria: ['A19'], risks, mode: 'risk' });
    assert.equal(before.errors.length, 1);
    assert.match(before.errors[0], /A19\.1 \(P0\)/);

    // Accepted global RFC (created without --phase during spec check) citing A19 satisfies the gate.
    const c = op.runtimeRfc(dir, null, { action: 'new', title: 'Arquitetura global A19', by: 'tl' });
    const f = path.join(dir, c.file);
    fs.writeFileSync(
      f,
      fs.readFileSync(f, 'utf8')
        .replace('(O problema técnico, ligado às histórias e critérios: US-n, R*, A*.)', 'Cobre A19 ponta a ponta.')
        .replace('(Desenho escolhido: componentes, contratos, dados, fluxo. Diagrama se ajudar.)', ' Isolamento total.')
        .replace('- **(alternativa)** — (por que foi recusada)', '- **Sem isolamento** — inseguro')
        .replace('- (nenhuma — apague esta linha quando não houver)', ''),
      'utf8',
    );
    op.runtimeRfc(dir, null, { action: 'accept', id: c.id, by: 'tl' });

    const afterAcc = rfcLib.lintPhaseRfc(dir, { phase: 'F2', phaseCriteria: ['A19'], risks, mode: 'risk' });
    assert.deepEqual(afterAcc, { errors: [], warnings: [] });
  });
});

describe('Round 10 — Decisions importDiscuss escaped pipes & status==="done" in lintDecisions', () => {
  it('imports bold **D-01** rows with escaped \\| and skips superseded warning on status==="done" tasks', () => {
    const dir = mkDir();
    const pdir = path.join(dir, '.oxe', 'program');
    const discuss = [
      '| ID | Decisão | Data | Impacto |',
      '|---|---|---|---|',
      '| **D-01** | Usar canal `a \\| b` *(revertida por **D-02**)* | 2026-11-15 | trocar parser |',
      '| **D-02** | Usar protocolo binário | 2026-11-15 | novo codec |',
    ].join('\n');

    const res = decisionsLib.importDiscuss(pdir, discuss, { phase: 'F1' });
    assert.deepEqual(res.imported, ['D-01', 'D-02']);
    const list = decisionsLib.list(pdir);
    const d1 = list.find((d) => d.id === 'D-01');
    assert.equal(d1.title, 'Usar canal `a | b`');
    assert.equal(d1.status, 'superseded');
    assert.equal(d1.superseded_by, 'D-02');

    const lintDone = decisionsLib.lintDecisions(
      { tasks: [{ id: 'T1', status: 'done', decisions: ['D-01'] }, { id: 'T2', status: 'pending', decisions: ['D-02'] }] },
      list,
      'F1',
    );
    assert.deepEqual(lintDone, { errors: [], warnings: [] });
  });
});

describe('Round 10 — docs-publish skipped accuracy & ADR stateless rendering', () => {
  it('reports SYSTEM-DESIGN skip accurately regardless of GLOSSARY presence and never duplicates ## Itens no ALM', () => {
    const dir = mkDir();
    const prdPath = write(dir, '.oxe/PRD.md', '# PRD\n\n## Itens no ALM\n\n| História | Item |\n|---|---|\n| US-1 | OXE-1 |\n');
    const designPath = write(dir, '.oxe/SYSTEM-DESIGN.md', '# Design\n');
    const glossaryPath = write(dir, '.oxe/GLOSSARY.md', '# Glossário\n');
    const almLinks = new Map([['US-1', { ref: 'US-1', key: 'OXE-1' }]]);

    // Case 1: design present, glossary absent -> SYSTEM-DESIGN is NOT in skipped.
    const r1 = docsPublishLib.publish(dir, 'docs', { prdFile: prdPath, almLinks, designFile: designPath });
    assert.ok(!r1.skipped.some((s) => /SYSTEM-DESIGN/.test(s)), `unexpected skip: ${r1.skipped.join('; ')}`);
    const publishedPrd = fs.readFileSync(path.join(dir, 'docs/product/PRD.md'), 'utf8');
    assert.equal((publishedPrd.match(/^## Itens no ALM$/gm) || []).length, 1, 'must not duplicate ## Itens no ALM');

    // Case 2: design absent, glossary present -> SYSTEM-DESIGN IS in skipped, and GLOSSARY is published.
    const dir2 = mkDir();
    const r2 = docsPublishLib.publish(dir2, 'docs', { glossaryFile: glossaryPath });
    assert.ok(r2.skipped.some((s) => /SYSTEM-DESIGN/.test(s)), 'missing SYSTEM-DESIGN must be reported even when GLOSSARY exists');
    assert.ok(r2.written.includes('docs/product/GLOSSARY.md'));
  });

  it('renderAdr and renderIndex resolve deterministic links without prior publish() or global state leakage', () => {
    const d1 = { id: 'D-F1-1', title: 'Fila SQLite', status: 'superseded', superseded_by: 'D-F1-2', at: '2026-11-15T00:00:00Z' };
    const d2 = { id: 'D-F1-2', title: 'Fila WAL', status: 'active', supersedes: 'D-F1-1', at: '2026-11-15T01:00:00Z' };
    const byId = new Map([[d1.id, d1], [d2.id, d2]]);

    const adr1 = adrLib.renderAdr(d1, byId);
    assert.match(adr1, /\[D-F1-2\]\(D-F1-2-fila-wal\.md\)/);
    const idx = adrLib.renderIndex([d1, d2]);
    assert.match(idx, /\[D-F1-1\]\(D-F1-1-fila-sqlite\.md\)/);
    assert.match(idx, /\[D-F1-2\]\(D-F1-2-fila-wal\.md\)/);
  });
});

describe('Round 10 — docs-check URL/comment/Removido exclusions & $-prefixed symbol tracking', () => {
  it('ignores URLs, fenced blocks, HTML comments and Removido rows, and tracks $store across files', () => {
    const dir = mkDir();
    write(dir, 'src/state.ts', 'export const other = 1;\n');
    write(dir, 'src/new-state.ts', 'export const $store = { ok: true };\n');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir });

    const docText = [
      'Veja https://github.com/org/repo/blob/main/src/nao-existe.ts#foo para histórico.',
      '<!-- comentário com src/fantasma.ts#bar -->',
      '```ts',
      'import { x } from "src/exemplo-ficticio.ts";',
      '```',
      '| `src/antigo.ts` | T1 | Removido |',
      'O estado reativo fica em `src/new-state.ts#$store` (antes em `src/state.ts#$store`).',
    ].join('\n');

    const claims = docsCheckLib.claimsOf(docText);
    assert.deepEqual(
      claims.map((c) => `${c.file}#${c.symbol || ''}`),
      ['src/new-state.ts#$store', 'src/state.ts#$store'],
    );

    const out = docsCheckLib.check(dir, {
      program: { phases: [{ id: 'F1', status: 'closed' }] },
      decisions: [{ id: 'D-F1-1', phase: 'F1', status: 'active', title: 'Estado', text: docText }],
      dossierRoot: path.join(dir, '.oxe', 'dossier'),
    });
    assert.equal(out.divergences.length, 1);
    assert.deepEqual(
      [out.divergences[0].cite, out.divergences[0].why, out.divergences[0].now],
      ['src/state.ts#$store', 'mudou de lugar', ['src/new-state.ts']],
    );
  });
});

describe('Round 10 — ship-pr paginated comment arrays & Azure AB# card matching', () => {
  it('parses concatenated multi-page gh api --paginate arrays (including ][ inside strings) and matches AB# cards on branches', () => {
    const page1 = JSON.stringify([{ id: 1, body: 'Veja [doc][ref] e arr[0][1]' }]);
    const page2 = JSON.stringify([{ id: 42, body: `${shipPrLib.MARKER}\n**CI (OXE): verde**` }]);
    const parsed = shipPrLib.parsePaginatedJsonArray(`${page1}\n${page2}`);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].id, 42);

    const patched = [];
    const fakeSpawn = (_cmd, args, opts = {}) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            { number: 901, title: 'feat: login', headRefName: 'feat/ab-123-sso', url: 'u', labels: [], isDraft: false, state: 'OPEN', body: '' },
            { number: 902, title: 'chore: deps', headRefName: 'chore/deps', url: 'u2', labels: [], isDraft: false, state: 'OPEN', body: '' },
          ]),
        };
      }
      if (args[0] === 'api' && /issues\/901\/comments$/.test(args[1])) {
        return { status: 0, stdout: `${page1}${page2}` };
      }
      if (args[0] === 'api' && args[1] === '-X' && args[2] === 'PATCH') {
        patched.push({ endpoint: args[3], body: opts.input });
        return { status: 0, stdout: '{}' };
      }
      return { status: 1, stderr: 'unexpected' };
    };

    const matched = shipPrLib.selectPrs(fakeSpawn, process.cwd(), { card: 'AB#123' });
    assert.deepEqual(matched.map((p) => p.number), [901]);

    const pub = shipPrLib.publishVerdict(process.cwd(), { pr: 901, ci: { state: 'green', failed: [] } }, { spawn: fakeSpawn });
    assert.deepEqual(pub, { pr: 901, updated: true, created: false });
    assert.equal(patched.length, 1);
    assert.equal(patched[0].endpoint, 'repos/{owner}/{repo}/issues/comments/42');
  });
});
