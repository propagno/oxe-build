'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const refine = require('../bin/lib/oxe-alm-refine.cjs');
const op = require('../bin/lib/oxe-operational.cjs');

describe('v1.23.0 ALM refine — rastreabilidade de artefatos OXE e isenção de repos CLI', () => {
  it('discoverProjectArtifacts + skeleton + lintSpec enforce upstream PRD/SYSTEM-DESIGN/ADR traceability', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-art-trace-'));
    try {
      fs.mkdirSync(path.join(dir, '.oxe'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.oxe', 'PRD.md'), '# PRD\n| US-1 | dev | quero | para | R1 | A1 | P1 · OB-4 |\n');
      fs.writeFileSync(path.join(dir, '.oxe', 'SYSTEM-DESIGN.md'), '# SYSTEM-DESIGN\n');
      fs.writeFileSync(path.join(dir, '.oxe', 'GLOSSARY.md'), '# GLOSSARY\n');
      fs.writeFileSync(path.join(dir, 'docs', 'adr', 'D-1-arch.md'), '# D-1\n');

      const art = refine.discoverProjectArtifacts(dir, null, 'OB-4');
      assert.equal(art.has_any, true);
      assert.equal(art.prd.path, '.oxe/PRD.md');
      assert.deepEqual(art.prd.stories, ['US-1']);
      assert.equal(art.system_design.path, '.oxe/SYSTEM-DESIGN.md');
      assert.equal(art.glossary.path, '.oxe/GLOSSARY.md');
      assert.equal(art.adrs.length, 1);

      const sk = refine.skeleton({
        key: 'OB-4',
        url: 'https://jira.example/browse/OB-4',
        kind: 'story',
        type: 'Story',
        status: 'To Do',
        summary: 'Feature com rastreabilidade',
        description: 'Contexto inicial',
        description_hash: 'abc',
        fix_versions: [],
        links: [],
        design_refs: [],
        code_refs: [],
        code_refs_found: [],
        project_artifacts: art,
        collected_at: '2026-11-26T00:00:00Z',
      });
      assert.match(sk, /## Arquitetura e fluxo/);
      assert.match(sk, /PRD: `\.oxe\/PRD\.md` \(US-1\)/);
      assert.match(sk, /Arquitetura \(SYSTEM-DESIGN\): `\.oxe\/SYSTEM-DESIGN\.md`/);
      assert.match(sk, /ADRs: `docs\/adr\/D-1-arch\.md`/);

      const storyWithoutRefs = [
        '# OB-4 — Feature',
        '## História',
        'Como dev, quero X, para Y.',
        '## Critérios de aceite',
        '1. **CA-1** — Dado A, quando B, então retorna 200 · Teste: tests/a.test.cjs',
        '## Regras de negócio',
        '- **RN-1** — Regra',
        '## Regras técnicas',
        '- **RT-1** — Módulo',
        '## Fora de escopo',
        '- Nada extra',
        '## Definição de pronto',
        '- Teste verde',
        '## Perguntas em aberto',
        '- Nenhuma',
      ].join('\n');
      const warnLint = refine.lintSpec(storyWithoutRefs, 'story', { artifacts: art });
      assert.equal(warnLint.ok, true);
      assert.ok(warnLint.warnings.some((w) => /rastreabilidade:/.test(w)));
      assert.ok(warnLint.warnings.some((w) => /arquitetura:/.test(w)));

      const storyWithRefs = `${storyWithoutRefs}\n\n## Arquitetura e fluxo\n\n- Consultar .oxe/SYSTEM-DESIGN.md e ADR D-1\n\n## Referências\n\n- .oxe/PRD.md#US-1\n`;
      const cleanLint = refine.lintSpec(storyWithRefs, 'story', { artifacts: art });
      assert.equal(cleanLint.ok, true);
      assert.equal(cleanLint.warnings.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uiCardGaps exempts epics and pure CLI repositories without UI directories when projectRoot is provided', () => {
    const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-cli-repo-'));
    try {
      fs.mkdirSync(path.join(cliDir, 'bin', 'lib'), { recursive: true });
      const md = [
        '# OB-11 — Gatilhos de preflight',
        '## Contexto',
        'Gatilho monitorando src/ui/** e src/design/targets/*.json em repositórios consumidores.',
        '## Critérios de aceite',
        '1. **CA-1** — Dado src/ui/Button.tsx alterado, retorna 1 gatilho · Teste: tests/pf.test.cjs',
      ].join('\n');

      const epicRes = op.uiCardGaps(md, { kind: 'epic', labels: [] });
      assert.equal(epicRes.isUi, false);
      assert.equal(epicRes.epic_exempt, true);

      const cliRes = op.uiCardGaps(md, { kind: 'story', labels: [] }, { projectRoot: cliDir });
      assert.equal(cliRes.isUi, false);
      assert.equal(cliRes.no_ui_tree_exempt, true);

      // Explicit area-marca still triggers G34 even in a CLI repo
      const marcaRes = op.uiCardGaps(md, { kind: 'story', labels: ['area-marca'] }, { projectRoot: cliDir });
      assert.equal(marcaRes.isUi, true);
    } finally {
      fs.rmSync(cliDir, { recursive: true, force: true });
    }
  });
});
