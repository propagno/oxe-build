# PLAN

> Gerado por `oxe-cc plan build` a partir de F9.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-58: Auto-configuracao assistida via onboard --propose-config (--dry-run padrao e --apply nao-destrutivo)

- **Arquivos prováveis:** `bin/lib/oxe-onboard.cjs`, `bin/lib/commands/ops-commands.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a19-onboard-propose.test.cjs`
- **Aceite vinculado:** A19

## Onda 2

### T2 — OB-59: CiAdapter provider-agnostico (github, gitlab, azure-devops, local) integrado a ship e release

- **Arquivos prováveis:** `bin/lib/oxe-ci-adapter.cjs`, `bin/lib/oxe-ship-pr.cjs`, `bin/lib/oxe-release-ops.cjs`, `bin/lib/oxe-operational.cjs`, `lib/sdk/index.d.ts`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a20-ci-adapter.test.cjs`
- **Aceite vinculado:** A20

## Onda 3

### T3 — OB-60: Roteamento empirico de modelos (scorecard --with-routing + plan build suggested_model_hint) e docs v1.22.2

- **Arquivos prováveis:** `bin/lib/oxe-scorecard.cjs`, `bin/lib/oxe-plan-build.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`, `lib/sdk/index.d.ts`, `oxe/templates/CONFIG.md`, `oxe/workflows/help.md`, `oxe/workflows/ship.md`, `CHANGELOG.md`
- **Depende de:** T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a21-model-routing.test.cjs`
- **Aceite vinculado:** A21
