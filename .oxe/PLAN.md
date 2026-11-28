# PLAN — F9

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-16: PRD por sessao + tabela compacta, [G30] agrupado, ci-parity scorecard drift e oxe-cc workflow new

- **Arquivos prováveis:** `bin/lib/oxe-prd.cjs`, `bin/lib/oxe-operational.cjs`, `bin/lib/oxe-suite-impact.cjs`, `bin/lib/oxe-ci-parity.cjs`, `bin/lib/oxe-workflows.cjs`, `bin/oxe-cc.js`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a16-dogfooding-ergonomics.test.cjs`
- **Aceite vinculado:** A16
