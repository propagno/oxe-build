# PLAN — F7

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-14: Runner headless oxe-deliver-runner.cjs (deliver run) e oxe-deliver-handoff.cjs (FINAL_SMOKE + DELIVERY.md/DELIVERY.json)

- **Arquivos prováveis:** `bin/lib/oxe-deliver-handoff.cjs`, `bin/lib/oxe-deliver-runner.cjs`, `bin/lib/oxe-operational.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a14-deliver-runner-smoke.test.cjs`
- **Aceite vinculado:** A14
