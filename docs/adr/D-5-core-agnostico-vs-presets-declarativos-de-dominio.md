<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-5 — Core agnostico vs presets declarativos de dominio

- **Status:** Aceita
- **Data:** 2026-11-26
- **Critérios:** A5, A6
- **Por:** arquitetura

## Contexto

Avaliacao de maturidade v1.22.0 detectou acoplamento de heuristicas OXESpace em 6 arquivos do core (uiCardGaps, oxe-ship-pr, oxe-env-sanitize, oxe-release-ops, oxe-preflight, oxe-vitest-batch), causando bloqueios falsos em repositorios CLI/Web genericos.

## Decisão

O core do oxe-build mantem defaults 100% agnosticos; heuristicas especificas de dominio (brand gate BRD-n, marca/conformidade, src/design/targets, OXESPACE_*/AI_MEMORY_*, noBatchPatterns e expectedAssets Desktop+APK) vivem em bin/lib/oxe-presets.cjs (cli, web, desktop-mobile, brand-strict) com opt-in declarativo e precedencia config explicita > preset > default agnostico.

## Consequências

Projetos CLI/Web rodam release-readiness, preflight, alm refine lint e ship status sem falsos bloqueios de .apk ou BRD-n; projetos existentes mantem 100% de retrocompatibilidade via preset brand-strict/desktop-mobile ou deteccao automatica de src/design/targets e area-marca.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
