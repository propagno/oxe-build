# OXE — Fixture Pack

> Fixtures mínimos para reduzir improviso em parsing, integração, transformação, migração e builders.

## Status

- **Status:** ready | not_ready | not_applicable
- **Critical gaps abertos:** nenhum | listar
- **Cobertura de tarefas de risco:** N/N

## Fixtures

### FX-01 — T1

- **Task:** T1
- **Status:** ready | missing | not_applicable
- **Inputs:** payload, arquivo exemplo, query, blob ou mensagem
- **Expected outputs:** linha, evento, arquivo, rowset, status etc.
- **Expected checks:** `...`
- **Campos críticos / offsets:** ...
- **Smoke command:** `...`
- **Negative cases:** input inválido, erro esperado, limite ou regressão principal
- **Source anchor:** RA-01 | not_applicable
- **Critical gaps:** nenhum | listar

## Regras

- Parser, layout posicional, integração externa, fila, migração, transformação e builder exigem fixture `ready`.
- Docs-only pode usar `not_applicable`, mas precisa declarar o motivo.
- Fixture inventada sem anchor ou sem expected output não sustenta execução.
