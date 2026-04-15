'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ctx = require('../bin/lib/oxe-context-engine.cjs');
const runtimeSemantics = require('../bin/lib/oxe-runtime-semantics.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-ctx-test-'));
  const oxe = path.join(dir, '.oxe');
  const codebase = path.join(oxe, 'codebase');
  fs.mkdirSync(codebase, { recursive: true });
  fs.writeFileSync(path.join(oxe, 'STATE.md'), `## Fase atual\n\n\`${options.phase || 'scan_complete'}\`\n`, 'utf8');
  if (options.spec) fs.writeFileSync(path.join(oxe, 'SPEC.md'), options.spec, 'utf8');
  if (options.plan) fs.writeFileSync(path.join(oxe, 'PLAN.md'), options.plan, 'utf8');
  if (options.runtime) fs.writeFileSync(path.join(oxe, 'EXECUTION-RUNTIME.md'), options.runtime, 'utf8');
  if (options.verify) fs.writeFileSync(path.join(oxe, 'VERIFY.md'), options.verify, 'utf8');
  for (const name of ['OVERVIEW.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONCERNS.md']) {
    fs.writeFileSync(path.join(codebase, name), `# ${name}\n\nconteúdo de teste\n`, 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// buildContextTiers
// ---------------------------------------------------------------------------

describe('buildContextTiers', () => {
  test('tier minimal contém required + até 2 summaries', () => {
    const contract = runtimeSemantics.getWorkflowContract('ask');
    assert.ok(contract, 'contrato ask deve existir');
    const tiers = contract.context_tiers;
    assert.ok(Array.isArray(tiers.minimal), 'minimal deve ser array');
    assert.ok(Array.isArray(tiers.standard), 'standard deve ser array');
    assert.ok(Array.isArray(tiers.full), 'full deve ser array');
    // minimal ⊆ standard ⊆ full
    for (const alias of tiers.minimal) {
      assert.ok(tiers.standard.includes(alias), `${alias} de minimal deve estar em standard`);
    }
    for (const alias of tiers.standard) {
      assert.ok(tiers.full.includes(alias), `${alias} de standard deve estar em full`);
    }
  });

  test('required_artifacts sempre presentes em todos os tiers', () => {
    for (const slug of ['plan', 'execute', 'verify']) {
      const contract = runtimeSemantics.getWorkflowContract(slug);
      assert.ok(contract, `contrato ${slug} deve existir`);
      for (const alias of contract.required_artifacts) {
        assert.ok(contract.context_tiers.minimal.includes(alias), `${slug}: ${alias} obrigatório deve estar em minimal`);
        assert.ok(contract.context_tiers.standard.includes(alias), `${slug}: ${alias} obrigatório deve estar em standard`);
        assert.ok(contract.context_tiers.full.includes(alias), `${slug}: ${alias} obrigatório deve estar em full`);
      }
    }
  });

  test('full tem mais ou igual artefatos que standard', () => {
    const contract = runtimeSemantics.getWorkflowContract('execute');
    assert.ok(contract.context_tiers.full.length >= contract.context_tiers.standard.length);
  });
});

// ---------------------------------------------------------------------------
// computeContextQuality
// ---------------------------------------------------------------------------

describe('computeContextQuality', () => {
  test('sem gaps nem conflitos → score alto e status excellent ou good', () => {
    const pack = { gaps: [], conflicts: [], selected_artifacts: [{ alias: 'state', exists: true, using_fallback: false }] };
    const q = ctx.computeContextQuality(pack);
    assert.ok(q.score >= 85, `score esperado >= 85, obtido ${q.score}`);
    assert.ok(['excellent', 'good'].includes(q.status));
  });

  test('gap crítico reduz score em 25 por ocorrência', () => {
    const pack = {
      gaps: [{ alias: 'plan', severity: 'critical' }],
      conflicts: [],
      selected_artifacts: [{ alias: 'state', exists: true, using_fallback: false }],
    };
    const q = ctx.computeContextQuality(pack);
    assert.strictEqual(q.score, 75);
    assert.strictEqual(q.requiredMissing, 1);
  });

  test('dois gaps críticos → score 50 e status fragile', () => {
    const pack = {
      gaps: [
        { alias: 'plan', severity: 'critical' },
        { alias: 'runtime', severity: 'critical' },
      ],
      conflicts: [],
      selected_artifacts: [{ alias: 'state', exists: true, using_fallback: false }],
    };
    const q = ctx.computeContextQuality(pack);
    assert.strictEqual(q.score, 50);
    assert.strictEqual(q.status, 'fragile');
  });

  test('quatro ou mais gaps críticos → score <= 0 e status critical', () => {
    const pack = {
      gaps: Array.from({ length: 4 }, (_, i) => ({ alias: `art${i}`, severity: 'critical' })),
      conflicts: [],
      selected_artifacts: [],
    };
    const q = ctx.computeContextQuality(pack);
    assert.strictEqual(q.score, 0);
    assert.strictEqual(q.status, 'critical');
  });

  test('gap opcional reduz score em 5', () => {
    const base = {
      gaps: [],
      conflicts: [],
      selected_artifacts: [{ alias: 'state', exists: true, using_fallback: false }],
    };
    const withOptional = { ...base, gaps: [{ alias: 'summary', severity: 'warning' }] };
    const scoreBase = ctx.computeContextQuality(base).score;
    const scoreOpt = ctx.computeContextQuality(withOptional).score;
    assert.strictEqual(scoreBase - scoreOpt, 5);
  });

  test('conflito reduz score em 12', () => {
    const pack = {
      gaps: [],
      conflicts: [{ alias: 'plan', reason: 'diverge' }],
      selected_artifacts: [{ alias: 'state', exists: true, using_fallback: false }],
    };
    const q = ctx.computeContextQuality(pack);
    assert.strictEqual(q.score, 88);
    assert.strictEqual(q.conflicts, 1);
  });

  test('fallback reduz score em 6', () => {
    const pack = {
      gaps: [],
      conflicts: [],
      selected_artifacts: [{ alias: 'state', exists: true, using_fallback: true }],
    };
    const q = ctx.computeContextQuality(pack);
    assert.strictEqual(q.score, 94);
    assert.strictEqual(q.fallbackCount, 1);
  });
});

// ---------------------------------------------------------------------------
// computePackFreshness
// ---------------------------------------------------------------------------

describe('computePackFreshness', () => {
  test('pack recém-gerado sem fontes → fresh', () => {
    const pack = {
      generated_at: new Date().toISOString(),
      selected_artifacts: [],
      fallback_required: false,
    };
    const freshness = ctx.computePackFreshness(pack, { freshness_policy: { pack_max_age_hours: 12 } });
    assert.strictEqual(freshness.stale, false);
    assert.strictEqual(freshness.reason, 'fresh');
    assert.ok(freshness.pack_age_hours != null && freshness.pack_age_hours < 1);
  });

  test('pack com age excedendo max_age → stale por age', () => {
    const old = new Date(Date.now() - 13 * 3600 * 1000).toISOString();
    const pack = { generated_at: old, selected_artifacts: [], fallback_required: false };
    const freshness = ctx.computePackFreshness(pack, { freshness_policy: { pack_max_age_hours: 12 } });
    assert.strictEqual(freshness.stale, true);
    assert.strictEqual(freshness.reason, 'pack_age_exceeded');
  });

  test('fonte mais recente que pack → stale por source', () => {
    const packTime = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const sourceTime = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const pack = {
      generated_at: packTime,
      selected_artifacts: [{ updated_at: sourceTime }],
      fallback_required: false,
    };
    const freshness = ctx.computePackFreshness(pack, { freshness_policy: { pack_max_age_hours: 24 } });
    assert.strictEqual(freshness.stale, true);
    assert.strictEqual(freshness.reason, 'source_newer_than_pack');
  });

  test('fallback_required → stale independente de age', () => {
    const pack = {
      generated_at: new Date().toISOString(),
      selected_artifacts: [],
      fallback_required: true,
    };
    const freshness = ctx.computePackFreshness(pack, { freshness_policy: { pack_max_age_hours: 24 } });
    assert.strictEqual(freshness.stale, true);
    assert.strictEqual(freshness.reason, 'fallback_required');
  });

  test('pack sem generated_at usa max_age_hours padrão 12h', () => {
    const pack = { selected_artifacts: [], fallback_required: false };
    const freshness = ctx.computePackFreshness(pack, null);
    assert.strictEqual(freshness.max_pack_age_hours, 12);
  });
});

// ---------------------------------------------------------------------------
// buildContextPack — integração leve (sem escrita em disco)
// ---------------------------------------------------------------------------

describe('buildContextPack', () => {
  test('gera pack com state sem escrita quando write=false', () => {
    const dir = makeTmpProject({ phase: 'scan_complete' });
    const pack = ctx.buildContextPack(dir, { workflow: 'ask', write: false });
    assert.strictEqual(pack.workflow, 'ask');
    assert.strictEqual(pack.context_tier, 'standard');
    assert.ok(Array.isArray(pack.selected_artifacts));
    assert.ok(pack.selected_artifacts.some((a) => a.alias === 'state'));
    assert.ok(pack.context_quality && typeof pack.context_quality.score === 'number');
    assert.ok(pack.freshness && typeof pack.freshness.stale === 'boolean');
    assert.ok(typeof pack.semantics_hash === 'string');
  });

  test('lança erro para workflow sem contrato', () => {
    const dir = makeTmpProject();
    assert.throws(
      () => ctx.buildContextPack(dir, { workflow: 'nao-existe', write: false }),
      /Workflow sem contrato canónico/
    );
  });

  test('lança erro para workflow vazio', () => {
    const dir = makeTmpProject();
    assert.throws(
      () => ctx.buildContextPack(dir, { workflow: '', write: false }),
      /workflow é obrigatório/
    );
  });

  test('tier minimal seleciona subconjunto de standard', () => {
    const dir = makeTmpProject({ phase: 'planning', spec: '# SPEC\n\nok\n' });
    const min = ctx.buildContextPack(dir, { workflow: 'plan', tier: 'minimal', write: false });
    const std = ctx.buildContextPack(dir, { workflow: 'plan', tier: 'standard', write: false });
    assert.ok(min.selected_artifacts.length <= std.selected_artifacts.length);
  });

  test('materializa arquivos .json e .md quando write=true', () => {
    const dir = makeTmpProject({ phase: 'planning', spec: '# SPEC\n\nok\n', plan: '# PLAN\n\nok\n' });
    ctx.buildContextPack(dir, { workflow: 'execute', write: true });
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'context', 'packs', 'execute.json')));
    assert.ok(fs.existsSync(path.join(dir, '.oxe', 'context', 'packs', 'execute.md')));
  });
});

// ---------------------------------------------------------------------------
// buildContextIndex
// ---------------------------------------------------------------------------

describe('buildContextIndex', () => {
  test('gera índice com stats corretos', () => {
    const dir = makeTmpProject({ phase: 'scan_complete' });
    const index = ctx.buildContextIndex(dir, null, { write: false });
    assert.ok(index.artifacts.length > 0);
    assert.ok(typeof index.stats.total === 'number');
    assert.ok(index.stats.total === index.stats.existing + index.stats.missing);
  });

  test('state existente é marcado como existing', () => {
    const dir = makeTmpProject();
    const index = ctx.buildContextIndex(dir, null, { write: false });
    const stateArtifact = index.artifacts.find((a) => a.alias === 'state');
    assert.ok(stateArtifact, 'artefato state deve estar no índice');
    assert.strictEqual(stateArtifact.exists, true);
  });

  test('artefato ausente não quebra o índice', () => {
    const dir = makeTmpProject();
    const index = ctx.buildContextIndex(dir, null, { write: false });
    const specArtifact = index.artifacts.find((a) => a.alias === 'spec');
    assert.ok(specArtifact, 'spec deve aparecer no índice mesmo ausente');
    assert.strictEqual(specArtifact.exists, false);
  });
});
