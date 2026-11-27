'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const almRefine = require('../../bin/lib/oxe-alm-refine.cjs');
const specCheck = require('../../bin/lib/oxe-spec-check.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const dirs = [];
after(() => {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkSampleRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1222-a11-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'adr', 'D-1-real.md'), '# D-1 — Real ADR\n');
  fs.writeFileSync(
    path.join(dir, 'bin', 'lib', 'real-mod.cjs'),
    '\'use strict\';\nfunction realFn() { return true; }\nmodule.exports = { realFn };\n',
  );
  return dir;
}

describe('A11 — OXB-222-11: Mechanical quality gates in alm refine lint and spec check', () => {
  it('OXB-222-11: alm refine lintSpec rejects nonexistent repo paths in Referencias and Arquitetura while allowing (novo) paths', () => {
    const dir = mkSampleRepo();

    const brokenCard = [
      '# OB-99 — Card com caminhos quebrados',
      '## História',
      'Como dev, quero validar caminhos, para evitar specs desatualizadas.',
      '## Critérios de aceite',
      '1. **CA-1** — Dado um card, quando validado, então retorna erro em 100% dos caminhos quebrados · Teste: tests/a.test.cjs',
      '## Regras de negócio',
      '- **RN-1** — Nunca aceitar path quebrado.',
      '## Regras técnicas',
      '- **RT-1** — Atualizar `bin/lib/real-mod.cjs`.',
      '## Arquitetura e fluxo',
      '- ADRs aplicáveis: `docs/adr/D-9-ghost.md`.',
      '## Fora de escopo',
      '- Mudar API externa.',
      '## Definição de pronto',
      '- Teste verde.',
      '## Referências',
      '- Código: `bin/lib/real-mod.cjs`, `bin/lib/ghost-file.cjs`',
      '## Perguntas em aberto',
      '- Nenhuma.',
    ].join('\n');

    const resBroken = almRefine.lintSpec(brokenCard, 'story', { projectRoot: dir });
    assert.equal(resBroken.ok, false, `must fail when cited paths do not exist: ${JSON.stringify(resBroken)}`);
    assert.ok(resBroken.errors.some((e) => e.includes('docs/adr/D-9-ghost.md')), `must flag missing ADR path: ${JSON.stringify(resBroken.errors)}`);
    assert.ok(resBroken.errors.some((e) => e.includes('bin/lib/ghost-file.cjs')), `must flag missing code path: ${JSON.stringify(resBroken.errors)}`);

    const validCard = brokenCard
      .replace('docs/adr/D-9-ghost.md', 'docs/adr/D-1-real.md')
      .replace('`bin/lib/ghost-file.cjs`', '`bin/lib/brand-new.cjs` (novo)');

    const resValid = almRefine.lintSpec(validCard, 'story', { projectRoot: dir });
    assert.equal(resValid.ok, true, `valid existing + (novo) paths must pass: ${JSON.stringify(resValid.errors)}`);
  });

  it('OXB-222-11: alm refine lintSpec warns when existing file is paired with missing symbol and warns on combo story/task cards', () => {
    const dir = mkSampleRepo();
    for (const extra of ['m1.cjs', 'm2.cjs', 'm3.cjs', 'm4.cjs']) {
      fs.writeFileSync(path.join(dir, 'bin', 'lib', extra), '\'use strict\';\nmodule.exports = {};\n');
    }

    const comboAndBadSymbol = [
      '# OB-100 — Ajustar cache, retry de lock, parser CJS, origem quick, mutacao e configuracao de EOL tudo junto em um unico card',
      '## História',
      'Como dev, quero corrigir 5 problemas diferentes, para fechar o sprint.',
      '## Critérios de aceite',
      '1. **CA-1** — Dado um arquivo, quando `bin/lib/real-mod.cjs` (`missingFn`) roda, então passa; e `m1.cjs` retorna 0 · Teste: tests/a.test.cjs',
      '## Regras de negócio',
      '- **RN-1** — Preservar compatibilidade.',
      '## Regras técnicas',
      '- **RT-1** — Estender `bin/lib/real-mod.cjs` (`missingFn`) para emitir aviso.',
      '## Fora de escopo',
      '- Nenhuma quebra de API.',
      '## Definição de pronto',
      '- Testes verdes.',
      '## Referências',
      '- Código: `bin/lib/real-mod.cjs`, `bin/lib/m1.cjs`, `bin/lib/m2.cjs`, `bin/lib/m3.cjs`, `bin/lib/m4.cjs`',
      '## Perguntas em aberto',
      '- Nenhuma.',
    ].join('\n');

    const res = almRefine.lintSpec(comboAndBadSymbol, 'story', { projectRoot: dir });
    assert.equal(res.ok, true, `symbol/cohesion findings are warnings, not hard errors: ${JSON.stringify(res.errors)}`);
    assert.ok(
      res.warnings.some((w) => /missingFn/.test(w) && /real-mod\.cjs/.test(w)),
      `must warn about missing symbol in existing file: ${JSON.stringify(res.warnings)}`,
    );
    assert.ok(
      res.warnings.some((w) => /coes[aã]o|granularidade|combo/i.test(w)),
      `must warn about combo story card: ${JSON.stringify(res.warnings)}`,
    );

    // Existing symbol + creation verb + epic exemption must NOT trigger false warnings
    const cleanCard = [
      '# OB-101 — Estender real-mod com novo helper',
      '## História',
      'Como dev, quero adicionar um helper, para validar contratos.',
      '## Critérios de aceite',
      '1. **CA-1** — Dado um input, quando `realFn` executa, então retorna true · Teste: tests/a.test.cjs',
      '## Regras de negócio',
      '- **RN-1** — Manter `realFn` intacta.',
      '## Regras técnicas',
      '- **RT-1** — Em `bin/lib/real-mod.cjs` (`realFn`), reutilizar fluxo e criar `brandNewHelper`.',
      '## Fora de escopo',
      '- Não alterar outros módulos.',
      '## Definição de pronto',
      '- Testes verdes.',
      '## Referências',
      '- Código: `bin/lib/real-mod.cjs`',
      '## Perguntas em aberto',
      '- Nenhuma.',
    ].join('\n');
    const cleanRes = almRefine.lintSpec(cleanCard, 'story', { projectRoot: dir });
    assert.equal(cleanRes.ok, true);
    assert.ok(!cleanRes.warnings.some((w) => /realFn|brandNewHelper|coes[aã]o/i.test(w)), `clean card must not warn: ${JSON.stringify(cleanRes.warnings)}`);

    const epicCard = [
      '# OB-102 — Epico multi-modulo',
      '## Objetivo',
      'Coordenar 5 módulos.',
      '## Escopo',
      '- Módulo 1..5',
      '## Fora de escopo',
      '- Deploy.',
      '## Métricas de sucesso',
      '- **M-1** — 100% verde.',
      '## Referências',
      '- Código: `bin/lib/real-mod.cjs`, `bin/lib/m1.cjs`, `bin/lib/m2.cjs`, `bin/lib/m3.cjs`, `bin/lib/m4.cjs`',
    ].join('\n');
    const epicRes = almRefine.lintSpec(epicCard, 'epic', { projectRoot: dir });
    assert.equal(epicRes.ok, true);
    assert.ok(!epicRes.warnings.some((w) => /coes[aã]o|granularidade|combo/i.test(w)), `epics must be exempt from combo warning: ${JSON.stringify(epicRes.warnings)}`);
  });

  it('OXB-222-11: spec check warns on missing Bordas/Proibicoes and overloaded criteria, and rejects nonexistent doc paths on disk', () => {
    const dir = mkSampleRepo();
    const longText = 'Executa parser A com retry de lock, cache de complexidade, exit code 1 no init, inferencia de simbolos CJS em plan build, suporte a allow_no_alm_quick em origin, prd lint com sessao, preservacao de ADRs raiz, supressao de falso positivo em suite impact e priorizacao de mutantes em arquivos grandes com line endings LF obrigatorios';
    const thinSpec = [
      '# OXE — SPEC',
      '## Requisitos',
      '| R-ID | Requisito | Versão | Critérios |',
      '|---|---|---|---|',
      '| R1 | Tudo junto conforme `docs/adr/D-99-fake.md` | v1 | A1 |',
      '## Critérios de aceite',
      '| ID | Critério | Risco | Como verificar |',
      '|---|---|---|---|',
      `| A1 | ${longText} | P2 | \`node --test tests/a1.test.cjs\` |`,
    ].join('\n');

    const bad = specCheck.checkSpec({ specText: thinSpec, fast: true, projectRoot: dir });
    assert.equal(bad.ok, false, `must fail on nonexistent ADR reference: ${JSON.stringify(bad)}`);
    assert.ok(bad.errors.some((e) => e.includes('docs/adr/D-99-fake.md')), `must report missing doc path: ${JSON.stringify(bad.errors)}`);
    assert.ok(bad.warnings.some((w) => /bordas|proibi[cç][oõ]es/i.test(w)), `must warn when Bordas/Proibicoes section is missing: ${JSON.stringify(bad.warnings)}`);
    assert.ok(bad.warnings.some((w) => /A1.*(sobrecarregado|extenso|longo)/i.test(w)), `must warn on overloaded A1 criterion: ${JSON.stringify(bad.warnings)}`);

    const richSpec = [
      '# OXE — SPEC',
      '## Requisitos',
      '| R-ID | Requisito | Versão | Critérios |',
      '|---|---|---|---|',
      '| R1 | Requisito focado conforme `docs/adr/D-1-real.md` | v1 | A1 |',
      '## Critérios de aceite',
      '| ID | Critério | Risco | Como verificar |',
      '|---|---|---|---|',
      '| A1 | `realFn` retorna `true` sem efeitos colaterais | P2 | `node --test tests/a1.test.cjs` |',
      '## Bordas e proibições',
      '- Proibido mutar arquivos fora do escopo.',
    ].join('\n');

    const good = specCheck.checkSpec({ specText: richSpec, fast: true, projectRoot: dir });
    assert.equal(good.ok, true, `rich SPEC with valid refs must pass: ${JSON.stringify(good.errors)}`);
    assert.ok(!good.warnings.some((w) => /bordas|proibi[cç][oõ]es|sobrecarregado/i.test(w)), `rich SPEC must not emit depth warnings: ${JSON.stringify(good.warnings)}`);
  });

  it('OXB-222-11: all v1.22.2 Jira specs OB-37..OB-49 pass lintSpec against real repo with zero errors', () => {
    for (let i = 37; i <= 49; i += 1) {
      const key = `OB-${i}`;
      const specPath = path.join(REPO_ROOT, '.oxe', 'alm', 'specs', `${key}.md`);
      const dataPath = path.join(REPO_ROOT, '.oxe', 'alm', 'refine', `${key}.json`);
      if (!fs.existsSync(specPath) || !fs.existsSync(dataPath)) continue;
      const md = fs.readFileSync(specPath, 'utf8');
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const res = almRefine.lintSpec(md, data.kind, { projectRoot: REPO_ROOT });
      assert.equal(res.ok, true, `${key} failed lintSpec against real repo: ${JSON.stringify(res.errors)}`);
    }
  });
});
