'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const op = require('../bin/lib/oxe-operational.cjs');
const refine = require('../bin/lib/oxe-alm-refine.cjs');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const ENV = { JIRA_SITE: 'https://example.atlassian.net', JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'secret-token', OXE_ALM_WRITER: 'oxespace-code-f3' };
const adf = (t) => ({ type: 'doc', version: 1, content: String(t || '').split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });

function makeCardSpec({ key, title, bodyLines = [], criteriaLines }) {
  return [
    `<!-- oxe-refine: ${key} -->`,
    `# ${key} — ${title}`,
    '',
    '## História',
    '',
    'Como **operador**, quero **ajustar o componente**, para **usar teclado e cores forçadas com previsibilidade**.',
    '',
    '## Contexto',
    '',
    '- Contexto do ajuste · BRD: nenhum (função nova) · alvo: src/components/Status.tsx',
    ...bodyLines,
    '',
    '## Critérios de aceite',
    '',
    ...criteriaLines,
    '',
    '## Regras de negócio',
    '',
    '- **RN-1** — Segue o desenho aprovado.',
    '',
    '## Regras técnicas',
    '',
    '- **RT-1** — Arquivos em src/ui/ e src/styles/. Nos dois temas (claro e escuro) e nas duas densidades (compacta e confortável).',
    '',
    '## Fora de escopo',
    '',
    '- Alterar telas fora do módulo.',
    '',
    '## Dependências',
    '',
    '- Nenhuma conhecida',
    '',
    '## Riscos',
    '',
    '- Regressão visual conferida na suíte de conformidade.',
    '',
    '## Definição de pronto',
    '',
    '- CA verdes no CI',
    '',
    '## Perguntas em aberto',
    '',
    '- Nenhuma',
    '',
  ].join('\n');
}

function setupMultiProgramWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-c4-ws-'));
  dirs.push(ws);

  const codeF3 = path.join(ws, 'oxespace-152-code-f3');
  const basePolish = path.join(ws, 'oxespace-152-base-polish');
  const approvalsPolish = path.join(ws, 'oxespace-152-approvals-polish');

  for (const d of [codeF3, basePolish, approvalsPolish]) fs.mkdirSync(path.join(d, '.oxe', 'program'), { recursive: true });
  fs.mkdirSync(path.join(codeF3, '.oxe', 'alm', 'refine'), { recursive: true });
  fs.mkdirSync(path.join(codeF3, '.oxe', 'alm', 'specs'), { recursive: true });

  fs.writeFileSync(path.join(codeF3, '.oxe', 'config.json'), JSON.stringify({
    alm: { provider: 'jira', program: 'code-f3', jira: { project: 'OXE' }, writer: 'oxespace-code-f3' },
  }));
  fs.writeFileSync(path.join(codeF3, '.oxe', 'SPEC.md'), [
    '# OXE — Especificação: OxeCode F3',
    '',
    '## Critérios de aceite',
    '',
    '| ID | Critério | Risco | Como verificar |',
    '|---|---|---|---|',
    ...Array.from({ length: 13 }, (_, i) => `| A${i + 1} | critério ${i + 1} do code-f3 (OXE-${100 + i}) | P2 | tests/f3-${i + 1}.test.ts |`),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(codeF3, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    phase: 'F3',
    tasks: [{ id: 'T1', title: 'A1 (OXE-100): web preview utf8', wave: 1, files: ['src/p.ts'], acceptance: ['A1'] }],
  }, null, 2));

  fs.writeFileSync(path.join(basePolish, '.oxe', 'ROADMAP.md'), '# Roteiro de Entrega — Polimento · Componentes base 1.5.2\n');
  fs.writeFileSync(path.join(basePolish, '.oxe', 'SPEC.md'), [
    '# OXE — Especificação: Polimento · Componentes base',
    '',
    '## Critérios de aceite',
    '',
    '| ID | Critério | Risco | Como verificar |',
    '|---|---|---|---|',
    ...Array.from({ length: 17 }, (_, i) => `| A${i + 1} | item base polish ${i + 1} (OXE-${190 + i}) | P2 | tests/pb-${i + 1}.test.ts |`),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(basePolish, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    phase: 'F1',
    summary: 'Polimento · Componentes base (1.5.2)',
    tasks: [
      { id: 'T5', title: 'A5 (OXE-194, PB-01·3): Sidebar forced-colors', wave: 1, files: ['src/styles/forced-colors.css'], acceptance: ['A5'] },
      { id: 'T9', title: 'A9 (OXE-198, PB-01·7): TitleTooltips focus 400 ms', wave: 1, files: ['src/ui/TitleTooltips.tsx'], acceptance: ['A9'] },
      { id: 'T14', title: 'A14 (OXE-203, PB-01·12): Item 14 base polish', wave: 2, files: ['src/ui/Button.tsx'], acceptance: ['A14'] },
      { id: 'T17', title: 'A17 (OXE-274, PB-01·15): Dialog footer hairline', wave: 2, files: ['src/ui/Overlay.tsx'], acceptance: ['A17'] },
    ],
  }, null, 2));

  fs.writeFileSync(path.join(approvalsPolish, '.oxe', 'ROADMAP.md'), '# Roteiro de Entrega — Polimento · Aprovações 1.5.2\n');
  fs.writeFileSync(path.join(approvalsPolish, '.oxe', 'SPEC.md'), [
    '# OXE — Especificação: Polimento · Aprovações',
    '',
    '## Critérios de aceite',
    '',
    '| ID | Critério | Risco | Como verificar |',
    '|---|---|---|---|',
    '| A1 | hub A1 (OXE-179) | P1 | tests/ap1.test.ts |',
    '| A3 | aviso flutuante (OXE-180) | P1 | tests/ag01b-toast.test.tsx |',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(approvalsPolish, '.oxe', 'PLAN.json'), JSON.stringify({
    schema_version: 1,
    phase: 'F1',
    summary: 'Polimento · Aprovações (1.5.2)',
    tasks: [{ id: 'T3', title: 'A3 (OXE-180, AG-01): approval toast', wave: 1, files: ['src/components/Approvals/ApprovalToast.tsx'], acceptance: ['A3'] }],
  }, null, 2));

  return { ws, codeF3, basePolish, approvalsPolish };
}

describe('OXB-C4: alm refine cross-program --spec & PLAN.json, G34 ms/system-colors, re-apply idempotent', () => {
  it('auto-discovers the card program across sibling worktrees and validates A14/A17/A5 against its SPEC and PLAN.json', async () => {
    const { codeF3 } = setupMultiProgramWorkspace();
    // OXE-203 is in base-polish (T14 -> A14 > A13 limit of code-f3) and uses qualified tag (base-polish:A14)
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'refine', 'OXE-203.json'), JSON.stringify({ key: 'OXE-203', kind: 'story', description_hash: 'h1', description: '' }));
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-203.md'), makeCardSpec({
      key: 'OXE-203',
      title: 'PB-01·12',
      criteriaLines: ['1. **CA-1 (base-polish:A14)** — Dado o botão, quando renderiza, então tem 32 px · Teste: tests/pb-14.test.ts'],
    }));
    // OXE-274 uses unqualified (A17) — auto-lookup finds OXE-274 in base-polish's PLAN.json (T17)
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'refine', 'OXE-274.json'), JSON.stringify({ key: 'OXE-274', kind: 'story', description_hash: 'h2', description: '' }));
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-274.md'), makeCardSpec({
      key: 'OXE-274',
      title: 'PB-01·15',
      criteriaLines: ['1. **CA-1 (A17)** — Dado o diálogo, quando rola, então o rodapé mede 32 px · Teste: tests/pb-17.test.ts'],
    }));
    // OXE-180 uses the workaround (plano: A3, Polimento · Aprovações) without (A3) in the label
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'refine', 'OXE-180.json'), JSON.stringify({ key: 'OXE-180', kind: 'story', description_hash: 'h3', description: '' }));
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-180.md'), makeCardSpec({
      key: 'OXE-180',
      title: 'AG-01',
      criteriaLines: ['1. **CA-1** — Dado um pedido, quando aparece o aviso, então tem atraso de 1200 ms (plano: A3, Polimento · Aprovações) · Teste: tests/ag01b-toast.test.tsx'],
    }));
    // Wrong A-n against PLAN.json: OXE-274 claiming (A14), which belongs to OXE-203 (T14) in base-polish
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'refine', 'OXE-194.json'), JSON.stringify({ key: 'OXE-194', kind: 'story', description_hash: 'h4', description: '' }));
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-194.md'), makeCardSpec({
      key: 'OXE-194',
      title: 'PB-01·3 mislinked',
      criteriaLines: ['1. **CA-1 (A14)** — Dado forced-colors, quando seleciona, então usa Highlight e HighlightText · Teste: tests/pb-5.test.ts'],
    }));

    const out = await op.runtimeAlmRefine(codeF3, null, { action: 'lint', keys: ['OXE-203', 'OXE-274', 'OXE-180', 'OXE-194'] });
    const byKey = new Map(out.results.map((r) => [r.key, r]));
    assert.equal(byKey.get('OXE-203').ok, true, JSON.stringify(byKey.get('OXE-203')));
    assert.equal(byKey.get('OXE-203').program, 'base-polish');
    assert.equal(byKey.get('OXE-274').ok, true, JSON.stringify(byKey.get('OXE-274')));
    assert.equal(byKey.get('OXE-274').program, 'base-polish');
    assert.equal(byKey.get('OXE-180').ok, true, JSON.stringify(byKey.get('OXE-180')));
    assert.equal(byKey.get('OXE-180').program, 'approvals-polish');
    assert.deepEqual(byKey.get('OXE-180').warnings, []);
    // Caught by PLAN.json cross-check even though A14 exists in base-polish's SPEC.md!
    assert.equal(byKey.get('OXE-194').ok, false);
    assert.ok(byKey.get('OXE-194').errors.some((e) => /A14 pertence a OXE-203.*T14.*OXE-194 está em T5 \(A5\)/.test(e)), JSON.stringify(byKey.get('OXE-194').errors));
  });

  it('explicit --spec <program|path> overrides SPEC lookup across lint, import, and apply', async () => {
    const { codeF3, basePolish } = setupMultiProgramWorkspace();
    // OXE-205 is a new card not yet added to base-polish PLAN.json: lint & import both accept --spec base-polish and --spec <path>
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'refine', 'OXE-205.json'), JSON.stringify({ key: 'OXE-205', kind: 'story', description_hash: 'h5', description: '' }));
    const cardMd = makeCardSpec({
      key: 'OXE-205',
      title: 'PB-01·18 novo critério',
      criteriaLines: [
        '1. **CA-1 (A16)** — Dado o item, quando renderiza, então usa 200 ms · Teste: tests/pb-16.test.ts',
        '2. **CA-2** — Dado o foco no teclado, quando aperta Tab, então responde em 400 ms · Teste: tests/pb-18.test.ts · Risco: P2',
      ],
    });
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-205.md'), cardMd);

    // Without --spec against code-f3 (max A13): A16 would fail if code-f3 is used, so --spec base-polish (and full path) works
    const lintBySlug = await op.runtimeAlmRefine(codeF3, null, { action: 'lint', keys: ['OXE-205'], spec: 'base-polish' });
    assert.equal(lintBySlug.results[0].ok, true, JSON.stringify(lintBySlug.results[0]));
    assert.equal(lintBySlug.results[0].program, 'base-polish');

    const lintByPath = await op.runtimeAlmRefine(codeF3, null, { action: 'lint', keys: ['OXE-205'], spec: path.join(basePolish, '.oxe', 'SPEC.md') });
    assert.equal(lintByPath.results[0].ok, true);

    // import --spec base-polish appends A18 into base-polish/.oxe/SPEC.md (not code-f3) and writes **CA-2 (base-polish:A18)**
    const imp = op.runtimeAlmRefineImport(codeF3, null, { keys: ['OXE-205'], spec: 'base-polish', by: 'po' });
    assert.equal(imp.program, 'base-polish');
    assert.deepEqual(imp.results[0].added.map((x) => [x.ca, x.a]), [['CA-2', 'A18']]);
    assert.match(fs.readFileSync(path.join(basePolish, '.oxe', 'SPEC.md'), 'utf8'), /\| A18 \|.*\(OXE-205\)/);
    assert.doesNotMatch(fs.readFileSync(path.join(codeF3, '.oxe', 'SPEC.md'), 'utf8'), /OXE-205/);
    assert.match(fs.readFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-205.md'), 'utf8'), /\*\*CA-2 \(base-polish:A18\)\*\*/);

    // apply --spec fails cleanly if a CA points to a missing criterion in that SPEC
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-205.md'), cardMd.replace('(A16)', '(A99)'));
    const badApply = await op.runtimeAlmRefine(codeF3, null, { action: 'apply', keys: ['OXE-205'], spec: 'base-polish', dryRun: true, http: async () => ({ status: 200, json: {} }), env: ENV });
    assert.match(badApply.results[0].error, /CA-1 aponta para A99, que não existe na SPEC de base-polish/);
  });

  it('G34 uiCardGaps accepts ms timings, Highlight/HighlightText/Canvas/CanvasText system colors, and forced-colors as valid measures', () => {
    const baseHeader = [
      '## Contexto',
      '- Ref: BRD: nenhum (polimento POLISH-01).',
      '- Arquivo: src/ui/StatusSignal.tsx (dois temas claro e escuro, duas densidades compacta e confortável).',
      '',
    ].join('\n');

    const mdMs = `${baseHeader}## Critérios de aceite\n1. **CA-1** — Dado foco por teclado, quando abre dica, então o atraso é de 400 ms · Teste: t.test.tsx\n`;
    const mdSysColors = `${baseHeader}## Critérios de aceite\n1. **CA-1** — Dado seleção no menu, então fundo usa Highlight com texto HighlightText e borda em Canvas e CanvasText · Teste: t.test.tsx\n`;
    const mdForced = `${baseHeader}## Critérios de aceite\n1. **CA-1** — Dado forced-colors ativo, quando renderiza, então o glifo segue as cores do sistema · Teste: t.test.tsx\n`;
    const mdUnmeasured = `${baseHeader}## Critérios de aceite\n1. **CA-1** — Dado botão, quando abre, então fica visível no painel · Teste: t.test.tsx\n`;

    assert.deepEqual(op.uiCardGaps(mdMs, { labels: ['area-marca'] }).gaps, []);
    assert.deepEqual(op.uiCardGaps(mdSysColors, { labels: ['area-marca'] }).gaps, []);
    assert.deepEqual(op.uiCardGaps(mdForced, { labels: ['area-marca'] }).gaps, []);
    assert.ok(op.uiCardGaps(mdUnmeasured, { labels: ['area-marca'] }).gaps.some((g) => /quais medidas/.test(g)));
  });

  it('re-apply overwrites an existing oxe-refine spec-vN description without --confirm-overwrite and without reposting "Texto original"', async () => {
    const issues = new Map([
      ['OXE-300', { id: '10300', key: 'OXE-300', fields: { summary: 'Ajuste spec', issuetype: { name: 'Story' }, description: adf('Texto bruto original do card.'), labels: [], comment: { comments: [] } } }],
    ]);
    const http = async (method, url, headers, body) => {
      const p = new URL(url).pathname;
      const m = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(p);
      if (m && method === 'GET') return { status: 200, json: issues.get(m[1]) };
      if (m && method === 'PUT') {
        const it = issues.get(m[1]);
        if (body.fields && body.fields.description) it.fields.description = body.fields.description;
        for (const l of (body.update && body.update.labels) || []) {
          if (l.add && !it.fields.labels.includes(l.add)) it.fields.labels.push(l.add);
          if (l.remove) it.fields.labels = it.fields.labels.filter((x) => x !== l.remove);
        }
        return { status: 204, json: null };
      }
      const cm = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/.exec(p);
      if (cm && method === 'POST') {
        issues.get(cm[1]).fields.comment.comments.push({ author: { displayName: 'oxe' }, body: body.body });
        return { status: 201, json: {} };
      }
      return { status: 404, json: null };
    };
    const ctx = {
      site: 'https://example.atlassian.net',
      request: async (method, url, body) => (await http(method, url, {}, body)).json,
    };

    const collected = await refine.collect(ctx, 'OXE-300');
    const mdV1 = makeCardSpec({
      key: 'OXE-300',
      title: 'Ajuste spec',
      criteriaLines: ['1. **CA-1** — Dado o botão, quando renderiza, então tem 32 px · Teste: tests/btn.test.ts'],
    });
    const r1 = await refine.apply(ctx, collected, mdV1);
    assert.equal(r1.applied, true);
    assert.equal(r1.version, 1);
    const commentsAfterV1 = issues.get('OXE-300').fields.comment.comments.map((c) => refine.adfToText(c.body));
    assert.equal(commentsAfterV1.filter((t) => /Texto original \(antes do refine\)/.test(t)).length, 1);

    // Fix local spec and re-apply WITHOUT --confirm-overwrite and WITHOUT re-collecting
    const mdV2 = mdV1.replace('tem 32 px', 'tem 36 px e atraso de 400 ms');
    const dryV2 = await refine.apply(ctx, collected, mdV2, { dryRun: true });
    assert.equal(dryV2.would.original_comment, false, 'dry-run must report no original comment reposted');

    const r2 = await refine.apply(ctx, collected, mdV2);
    assert.equal(r2.applied, true);
    assert.equal(r2.version, 2);
    assert.ok(issues.get('OXE-300').fields.labels.includes('spec-v1'));
    assert.ok(issues.get('OXE-300').fields.labels.includes('spec-v2'));
    const commentsAfterV2 = issues.get('OXE-300').fields.comment.comments.map((c) => refine.adfToText(c.body));
    assert.equal(commentsAfterV2.filter((t) => /Texto original \(antes do refine\)/.test(t)).length, 1, 'no duplicate Texto original comment');

    // Even if re-collected AFTER spec-v2 was applied, re-applying spec-v3 still does NOT post spec-v2 as "Texto original"
    const reCollected = await refine.collect(ctx, 'OXE-300');
    const mdV3 = mdV2.replace('400 ms', '300 ms');
    const r3 = await refine.apply(ctx, reCollected, mdV3);
    assert.equal(r3.applied, true);
    assert.equal(r3.version, 3);
    const commentsAfterV3 = issues.get('OXE-300').fields.comment.comments.map((c) => refine.adfToText(c.body));
    assert.equal(commentsAfterV3.filter((t) => /Texto original \(antes do refine\)/.test(t)).length, 1, 're-collected refined card still posts 0 extra original comments');

    // If a human completely replaces Jira description (no oxe-refine marker), guard still refuses without --confirm-overwrite
    issues.get('OXE-300').fields.description = adf('Texto reescrito manualmente pelo PO.');
    await assert.rejects(
      () => refine.apply(ctx, collected, mdV3.replace('300 ms', '250 ms')),
      /mudou depois da coleta/,
    );
  });

  it('OXB-C9 (OXE-270): alm refine lint keeps shared/locales/** G34 exemption when CAs cite *.test.tsx / *.spec.tsx', async () => {
    const { codeF3 } = setupMultiProgramWorkspace();
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'refine', 'OXE-270.json'), JSON.stringify({
      key: 'OXE-270',
      kind: 'story',
      labels: ['area-marca'],
      description_hash: 'h270',
      description: '',
    }));
    const ox270Md = makeCardSpec({
      key: 'OXE-270',
      title: 'Limpeza de chaves no catálogo',
      bodyLines: ['- Contexto: chaves usadas por `src/components/Composer.tsx`, alterações restritas ao catálogo.'],
      criteriaLines: [
        '1. **CA-1 (A1)** — Dado `shared/locales/pt-BR.json` e `shared/locales/en-US.json`, quando conferir as chaves referidas em `u62-u63-fold-and-composer.test.tsx:79`, então não restam chaves órfãs · Teste: `npx vitest run u62-u63-fold-and-composer.test.tsx` · Risco: P2',
      ],
    });
    fs.writeFileSync(path.join(codeF3, '.oxe', 'alm', 'specs', 'OXE-270.md'), ox270Md);

    const out = await op.runtimeAlmRefine(codeF3, null, { action: 'lint', keys: ['OXE-270'] });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].ok, true, JSON.stringify(out.results[0]));
    assert.equal(out.results[0].errors.length, 0, JSON.stringify(out.results[0].errors));
  });
});
