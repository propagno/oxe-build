<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-3 — Preflight local (<5s), impacto estático E2E e leitura explícita de marca/conformidade (G09/G10/G13/G14/G16)

- **Status:** Aceita
- **Data:** 2026-11-26
- **Critérios:** A6, A7, A8, A9, A10
- **Por:** arquitetura

## Contexto

Release 1.6.1 gastou ~2h30 em quebras tardias de seletores E2E/congeladas, tokens CSS órfãos e 4 divergências mascaradas em job verde (#1215).

## Decisão

oxe-cc preflight roda guardas baratos no pre-push, gatilhos UI/perf por glob, detector estático E2E/congeladas e alerta CSS em targets; oxe-ship-pr lê commit status marca/conformidade.

## Consequências

Regressões capturadas localmente em <5s antes da fila do CI; job verde nunca mascara enforced divergences > 0.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
