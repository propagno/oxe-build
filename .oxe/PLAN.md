# PLAN — F2

> Gerado por `oxe-cc plan build` a partir de F2.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-44: Aviso em grill --card, grill promote --card, spec check --card e grill import (unconfirmed)

- **Arquivos prováveis:** `bin/lib/oxe-grill.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a5-grill-card-import.test.cjs tests/oxe-1212-grill.test.cjs`
- **Aceite vinculado:** A5

## Onda 2

### T2 — OB-45: Confiabilidade Windows/CLI (--index-info + retry index.lock, cache complexity, program init exit 1, plan build CJS/symbols, origin allow_no_alm_quick)

- **Arquivos prováveis:** `bin/lib/oxe-operational.cjs`, `bin/lib/oxe-plan-build.cjs`, `bin/lib/oxe-origin.cjs`, `bin/oxe-cc.js`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a6-win-cli-reliability.test.cjs tests/oxe-lean-origin-guard.test.cjs tests/oxe-1212-complexity-api.test.cjs`
- **Aceite vinculado:** A6

## Onda 3

### T3 — OB-46: Polimento (prd lint --session, decision add safe, fim de unrun_acceptance_ci falso, plan mutate symbol-first, tsconfig newLine lf)

- **Arquivos prováveis:** `bin/lib/oxe-operational.cjs`, `bin/lib/oxe-decisions.cjs`, `bin/lib/oxe-suite-impact.cjs`, `bin/lib/oxe-plan-mutate.cjs`, `bin/oxe-cc.js`, `packages/runtime/tsconfig.json`, `packages/runtime/tsconfig.test.json`
- **Depende de:** T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a7-session-mutate-lf.test.cjs tests/oxe-plan-lint.test.cjs tests/oxe-lean-disambiguation-mutate.test.cjs`
- **Aceite vinculado:** A7
