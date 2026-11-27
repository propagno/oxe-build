# PLAN

> Gerado por `oxe-cc plan build` a partir de F8.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-56: Coordenacao multi-agente local (.git/oxe/active-agents.json), CLI oxe-cc agents e deteccao de colisao

- **Arquivos prováveis:** `bin/lib/oxe-agent-coord.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/lib/oxe-dir-info.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`, `lib/sdk/index.d.ts`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a17-agent-coord.test.cjs`
- **Aceite vinculado:** A17

## Onda 2

### T2 — OB-57: Reavaliacao continua de solucao (oxe-cc reevaluate) contra commits da base

- **Arquivos prováveis:** `bin/lib/oxe-reevaluate.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`, `lib/sdk/index.d.ts`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a18-reevaluate.test.cjs`
- **Aceite vinculado:** A18
