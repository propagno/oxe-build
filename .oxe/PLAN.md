# PLAN

> Gerado por `oxe-cc plan build` a partir de F2.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-29: Desacoplar heuristicas OXESpace para oxe-presets.cjs / config e publicar ADR D-5

- **Arquivos prováveis:** `bin/lib/oxe-operational.cjs`, `bin/lib/oxe-ship-pr.cjs`, `bin/lib/oxe-env-sanitize.cjs`, `bin/lib/oxe-vitest-batch.cjs`, `bin/lib/oxe-preflight.cjs`, `docs/adr/D-5-core-agnostico-vs-presets-declarativos-de-dominio.md`, `docs/adr/README.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a5-agnostic-core.test.cjs tests/oxe-1212-oxb-c4-alm-refine.test.cjs tests/oxe-1230-lote1-stability.test.cjs tests/oxe-1230-lote2-ci-rework.test.cjs tests/oxb-c20-dogfooding-gaps.test.cjs tests/oxb-c28-triage.test.cjs`
- **Aceite vinculado:** A5

### T2 — OB-30: Dirigir expectedAssets de oxe-release-ops.cjs pelo preset declarativo

- **Arquivos prováveis:** `bin/lib/oxe-release-ops.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a6-release-assets-preset.test.cjs tests/oxe-1230-lote3-release-governance.test.cjs`
- **Aceite vinculado:** A6

### T3 — OB-31: Adicionar --concurrency, --timings, --shard e --dry-run em scripts/quality-check.cjs

- **Arquivos prováveis:** `scripts/quality-check.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a7-quality-concurrency.test.cjs`
- **Aceite vinculado:** A7

## Onda 2

### T4 — OB-32: Extrair comandos v1.22 de bin/oxe-cc.js para bin/lib/commands/ops-commands.cjs

- **Arquivos prováveis:** `bin/oxe-cc.js`, `bin/lib/commands/ops-commands.cjs`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a8-cli-commands-extract.test.cjs tests/oxe-command-registry.test.cjs tests/oxe-cli-purity.test.cjs tests/oxe-1230-lote1-stability.test.cjs tests/oxe-1230-lote2-ci-rework.test.cjs tests/oxe-1230-lote3-release-governance.test.cjs`
- **Aceite vinculado:** A8

### T5 — OB-33: Extrair child-env e alm-refine-runtime de bin/lib/oxe-operational.cjs preservando 209 exports e ADR D-6

- **Arquivos prováveis:** `bin/lib/oxe-operational.cjs`, `bin/lib/operational/child-env.cjs`, `bin/lib/operational/alm-refine-runtime.cjs`, `docs/adr/D-6-decomposicao-strangler-fig-de-oxe-cc-e-oxe-operational.md`, `docs/adr/README.md`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a9-operational-slice1.test.cjs tests/oxe-1211-p0.test.cjs tests/oxe-1212-alm-refine.test.cjs tests/oxe-1212-oxb-c4-alm-refine.test.cjs tests/oxe-1230-alm-traceability.test.cjs tests/oxe-sdk-types.test.cjs`
- **Aceite vinculado:** A9
