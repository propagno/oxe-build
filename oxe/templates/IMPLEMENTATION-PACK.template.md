# OXE — Implementation Pack

> Contrato racional de implementação por tarefa. Este arquivo complementa o `PLAN.md` e fecha write-set, symbols, contracts e checks esperados antes do `/oxe-execute`.

## Status

- **Status:** ready | not_ready | not_applicable
- **Critical gaps abertos:** nenhum | listar
- **Fonte:** `PLAN.md` + código real + anchors locais
- **Regra de confiança:** se qualquer tarefa mutável estiver `ready: false`, o plano não pode sustentar `Confiança > 90%`.

## Tarefas

### T1 — (título)

- **Mode:** mutating | docs_only | external | not_applicable
- **Ready:** true | false
- **Exact paths:** `src/...`, `config/...`
- **Write set:** closed | external | not_applicable
- **Mutation scope:** code | config | schema | migration | infra | docs
- **Risk:** low | medium | high | critical
- **Symbols alvo:**
  - `kind:name(path)` — assinatura ou shape esperado
- **Imports/dependências obrigatórias:**
  - `module` / `type` / `provider`
- **Contracts:**
  - **Nome:** (ex.: payload parser)
  - **Entrada:** ...
  - **Saída:** ...
  - **Invariants:** ...
  - **Not allowed:** ...
- **Sequência mínima:**
  1. Confirmar símbolo e contrato no path alvo.
  2. Implementar o menor delta.
  3. Rodar o check da tarefa.
  4. Registrar evidência.
- **Expected checks:**
  - `...`
- **Requires fixture:** true | false
- **Snippet/base local:** path ou `not_applicable`
- **Rollback/contensão:** comando, diff reversível, feature flag, checkpoint ou `not_applicable`
- **Critical gaps:** nenhum | listar

## Observações

- Use caminhos exatos; não usar `...`.
- Tarefa mutável sem `symbols`, `contracts`, `write_set: closed` e `expected_checks` não deve sustentar confiança `> 90%`.
- Tarefa L/XL ou integração externa precisa de sequência mínima, rollback/contensão e fixture ou justificativa explícita.
