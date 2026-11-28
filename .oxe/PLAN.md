# PLAN — F13

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-20: Remover mkdirSync ansioso em capabilities list e limpeza de dir pai em rollback-ws

- **Arquivos prováveis:** `bin/oxe-cc.js`, `bin/lib/oxe-phase-extras.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a20-lazy-dirs-no-empty.test.cjs`
- **Aceite vinculado:** A20
