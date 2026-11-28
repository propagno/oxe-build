# PLAN — F10

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-17: probeHttpServerSmoke (oxe-deliver-handoff.cjs), auto-branch/commit OXE-Deliver e ondas paralelas disjuntas (oxe-deliver-runner.cjs)

- **Arquivos prováveis:** `bin/lib/oxe-deliver-handoff.cjs`, `bin/lib/oxe-deliver-runner.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a17-deliver-pro-features.test.cjs`
- **Aceite vinculado:** A17
