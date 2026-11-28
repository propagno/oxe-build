# PLAN — F12

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-19: Atualizar oxe-artifact-catalog.cjs com 100% dos artefatos modernos e gate de 0 extras

- **Arquivos prováveis:** `bin/lib/oxe-artifact-catalog.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a19-catalog-zero-extras.test.cjs tests/oxe-map.test.cjs`
- **Aceite vinculado:** A19
