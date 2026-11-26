<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-6 — Decomposicao strangler fig de oxe-cc e oxe-operational

- **Status:** Aceita
- **Data:** 2026-11-26
- **Critérios:** A8, A9
- **Por:** arquitetura

## Contexto

Avaliacao de maturidade v1.22.0 identificou bin/oxe-cc.js (10.669 linhas) e bin/lib/oxe-operational.cjs (15.949 linhas, 209 exports) como principais gargalos de manutencao e revisao.

## Decisão

A decomposicao incremental dos monolitos bin/oxe-cc.js e bin/lib/oxe-operational.cjs segue o padrao Strangler Fig: comandos CLI migram para bin/lib/commands/*.cjs via oxe-command-registry.cjs e subdominios operacionais migram para bin/lib/operational/*.cjs com injecao explicita de dependencias (zero require circular), mantendo oxe-operational.cjs como fachada 100% compativel com todos os 209 exports e ABI TypeScript do SDK.

## Consequências

Fatia 1 reduz bin/oxe-cc.js em >=500 linhas e bin/lib/oxe-operational.cjs em >=700 linhas com 0 drift em check:sdk-types e 0 regressao nos testes existentes, estabelecendo o padrao seguro para fatias futuras na v1.23.0.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
