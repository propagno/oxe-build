<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-1 — Isolamento read-only e sanitização centralizada de env vars em subprocessos (G01/G02)

- **Status:** Aceita
- **Data:** 2026-11-26
- **Critérios:** A1, A2
- **Por:** arquitetura

## Contexto

check-origin criava .git/oxe/quick em CI read-only (#1186) e OXESPACE_*/AI_MEMORY_* vazavam para testes filhos.

## Decisão

mirrorDirOf(..., { readOnly: true }) nunca grava em .git/; bin/lib/oxe-env-sanitize.cjs centraliza envSanitize e stripEnvPrefixes antes de qualquer subprocesso.

## Consequências

Zero escritas em .git durante auditorias; allowlist explícita preservada via env_allow/envSanitize.allow.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
