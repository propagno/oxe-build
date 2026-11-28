# PLAN — F15

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-22: Ponteiro canônico active_session em .oxe/state.json, SPEC por sessão em oxe-spec-check.cjs, oxe-cc resume e client.resume()/client.gc()

- **Arquivos prováveis:** `bin/lib/oxe-state.cjs`, `bin/lib/oxe-spec-check.cjs`, `bin/lib/oxe-operational.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/oxe-cc.js`, `lib/sdk/client.cjs`, `lib/sdk/index.types.ts`, `lib/sdk/index.d.ts`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a22-single-session-resume.test.cjs tests/oxe-1212-state-contract.test.cjs && npm run test:sdk-types`
- **Aceite vinculado:** A22
