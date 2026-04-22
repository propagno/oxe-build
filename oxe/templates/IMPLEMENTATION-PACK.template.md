# OXE — Implementation Pack

> Contrato racional de implementação por tarefa. Este arquivo complementa o `PLAN.md` e fecha write-set, symbols, contracts e checks esperados antes do `/oxe-execute`.

## Status

- **Status:** ready | not_ready | not_applicable
- **Critical gaps abertos:** nenhum | listar
- **Fonte:** `PLAN.md` + código real + anchors locais

## Tarefas

### T1 — (título)

- **Mode:** mutating | docs_only | external | not_applicable
- **Ready:** true | false
- **Exact paths:** `src/...`, `config/...`
- **Write set:** closed | external | not_applicable
- **Symbols alvo:**
  - `kind:name(path)` — assinatura ou shape esperado
- **Contracts:**
  - **Nome:** (ex.: payload parser)
  - **Entrada:** ...
  - **Saída:** ...
  - **Invariants:** ...
  - **Not allowed:** ...
- **Expected checks:**
  - `...`
- **Requires fixture:** true | false
- **Snippet/base local:** path ou `not_applicable`
- **Critical gaps:** nenhum | listar

## Observações

- Use caminhos exatos; não usar `...`.
- Tarefa mutável sem `symbols`, `contracts`, `write_set: closed` e `expected_checks` não deve sustentar confiança `> 90%`.
