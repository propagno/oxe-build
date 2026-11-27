# PLAN

> Gerado por `oxe-cc plan build` a partir de F2.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-65: Auto-lease multi-agente em quick, runtime commit-task e runtime execute

- **Arquivos prováveis:** `bin/lib/oxe-agent-coord.cjs`, `bin/lib/oxe-quick.cjs`, `bin/lib/oxe-operational.cjs`, `bin/lib/oxe-project-health.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a4-auto-lease.test.cjs`
- **Aceite vinculado:** A4

## Onda 2

### T2 — OB-66: Integracao automatica de reevaluateAgainstBase no preflight de execute e promote

- **Arquivos prováveis:** `bin/lib/oxe-operational.cjs`, `bin/lib/operational/promote-runtime.cjs`, `bin/lib/oxe-project-health.cjs`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a5-auto-reevaluate.test.cjs`
- **Aceite vinculado:** A5

## Onda 3

### T3 — OB-67: Roteamento empirico opt-in models.auto_route consumindo suggested_model_hint

- **Arquivos prováveis:** `bin/lib/oxe-model-tiers.cjs`
- **Depende de:** T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a6-auto-route.test.cjs`
- **Aceite vinculado:** A6
