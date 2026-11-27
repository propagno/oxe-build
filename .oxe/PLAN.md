# PLAN — F4

> Gerado por `oxe-cc plan build` a partir de F4.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-50: Gates mecanicos de qualidade em alm refine lint (paths/ADRs, simbolos, anti-combo) e spec check (Bordas/Proibicoes, criterios extensos, paths)

- **Arquivos prováveis:** `bin/lib/oxe-alm-refine.cjs`, `bin/lib/operational/alm-refine-runtime.cjs`, `bin/lib/oxe-spec-check.cjs`, `bin/lib/oxe-operational.cjs`, `bin/lib/oxe-plan-build.cjs`, `docs/adr/`, `docs/adr/D-1-isolamento-read-only-e-sanitizacao-centralizada-de-env-vars.md`, `docs/adr/D-2-junction-segura-de-node-modules-condicionada-a-sha-256-de-pa.md`, `docs/adr/D-3-preflight-local-5s-impacto-estatico-e2e-e-leitura-explicita.md`, `docs/adr/D-4-governanca-de-release-unificada-retomada-idempotente-pos-rei.md`, `docs/adr/D-5-core-agnostico-vs-presets-declarativos-de-dominio.md`, `docs/adr/D-6-decomposicao-strangler-fig-de-oxe-cc-e-oxe-operational.md`, `docs/adr/D-7-paridade-pre-push-com-phase-gates-path-aware-json-compacto-e.md`, `docs/adr/README.md`, `CHANGELOG.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a11-spec-card-quality.test.cjs tests/oxe-1230-alm-traceability.test.cjs tests/oxe-1212-alm-refine.test.cjs tests/oxe-1212-grill.test.cjs`
- **Aceite vinculado:** A11
