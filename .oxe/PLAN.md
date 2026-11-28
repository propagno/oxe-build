# PLAN — F14

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-21: Zona .oxe/.cache/, fix junction NTFS em oxe-test-precheck.cjs, bin/lib/oxe-gc.cjs + CLI oxe-cc gc e gancho leve pos-phase close

- **Arquivos prováveis:** `bin/lib/oxe-gc.cjs`, `bin/lib/oxe-test-precheck.cjs`, `bin/lib/oxe-phase-extras.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a21-cache-and-gc.test.cjs tests/oxe-1212-test-precheck.test.cjs tests/oxe-1212-phase-extras.test.cjs`
- **Aceite vinculado:** A21
