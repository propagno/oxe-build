# PLAN — F3

> Gerado por `oxe-cc plan build` a partir de F3.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-47: Implementar computeLeadtimeAndCiMetrics e oxe-cc runtime scorecard --with-ci

- **Arquivos prováveis:** `bin/lib/oxe-scorecard.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a8-scorecard-ci.test.cjs tests/oxe-scorecard.test.cjs`
- **Aceite vinculado:** A8

### T2 — OB-48: Discovery nos workflows (lean/execute, ship, CONFIG + sync wrappers) e aviso stripEnvPrefixes no doctor --project

- **Arquivos prováveis:** `bin/lib/oxe-project-env.cjs`, `oxe/workflows/lean/execute.md`, `oxe/workflows/ship.md`, `oxe/templates/CONFIG.md`, `.cursor/commands/`, `.cursor/commands/oxe-discuss.md`, `.cursor/commands/oxe-execute.md`, `.cursor/commands/oxe-help.md`, `.cursor/commands/oxe-next.md`, `.cursor/commands/oxe-plan.md`, `.cursor/commands/oxe-quick.md`, `.cursor/commands/oxe-review-pr.md`, `.cursor/commands/oxe-scan.md`, `.cursor/commands/oxe-ship.md`, `.cursor/commands/oxe-spec.md`, `.cursor/commands/oxe-verify.md`, `.cursor/commands/oxe.md`, `.github/prompts/`, `.github/prompts/oxe-alm.prompt.md`, `.github/prompts/oxe-ask.prompt.md`, `.github/prompts/oxe-capabilities.prompt.md`, `.github/prompts/oxe-checkpoint.prompt.md`, `.github/prompts/oxe-compact.prompt.md`, `.github/prompts/oxe-dashboard.prompt.md`, `.github/prompts/oxe-debug.prompt.md`, `.github/prompts/oxe-discuss.prompt.md`, `.github/prompts/oxe-execute.prompt.md`, `.github/prompts/oxe-forensics.prompt.md`, `.github/prompts/oxe-help.prompt.md`, `.github/prompts/oxe-loop.prompt.md`, `.github/prompts/oxe-milestone.prompt.md`, `.github/prompts/oxe-next.prompt.md`, `.github/prompts/oxe-obs.prompt.md`, `.github/prompts/oxe-plan-agent.prompt.md`, `.github/prompts/oxe-plan.prompt.md`, `.github/prompts/oxe-project.prompt.md`, `.github/prompts/oxe-quick.prompt.md`, `.github/prompts/oxe-research.prompt.md`, `.github/prompts/oxe-retro.prompt.md`, `.github/prompts/oxe-review-pr.prompt.md`, `.github/prompts/oxe-route.prompt.md`, `.github/prompts/oxe-scan.prompt.md`, `.github/prompts/oxe-security.prompt.md`, `.github/prompts/oxe-session.prompt.md`, `.github/prompts/oxe-ship.prompt.md`, `.github/prompts/oxe-skill.prompt.md`, `.github/prompts/oxe-spec.prompt.md`, `.github/prompts/oxe-ui-review.prompt.md`, `.github/prompts/oxe-ui-spec.prompt.md`, `.github/prompts/oxe-update.prompt.md`, `.github/prompts/oxe-validate-gaps.prompt.md`, `.github/prompts/oxe-verify.prompt.md`, `.github/prompts/oxe-workstream.prompt.md`, `.github/prompts/oxe.prompt.md`, `commands/oxe/`, `commands/oxe/alm.md`, `commands/oxe/ask.md`, `commands/oxe/capabilities.md`, `commands/oxe/checkpoint.md`, `commands/oxe/compact.md`, `commands/oxe/dashboard.md`, `commands/oxe/debug.md`, `commands/oxe/discuss.md`, `commands/oxe/execute.md`, `commands/oxe/forensics.md`, `commands/oxe/help.md`, `commands/oxe/loop.md`, `commands/oxe/milestone.md`, `commands/oxe/next.md`, `commands/oxe/obs.md`, `commands/oxe/oxe.md`, `commands/oxe/plan-agent.md`, `commands/oxe/plan.md`, `commands/oxe/project.md`, `commands/oxe/quick.md`, `commands/oxe/research.md`, `commands/oxe/retro.md`, `commands/oxe/review-pr.md`, `commands/oxe/route.md`, `commands/oxe/scan.md`, `commands/oxe/security.md`, `commands/oxe/session.md`, `commands/oxe/ship.md`, `commands/oxe/skill.md`, `commands/oxe/spec.md`, `commands/oxe/ui-review.md`, `commands/oxe/ui-spec.md`, `commands/oxe/update.md`, `commands/oxe/validate-gaps.md`, `commands/oxe/verify-audit.md`, `commands/oxe/verify.md`, `commands/oxe/workflow-authoring.md`, `commands/oxe/workstream.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a9-discovery-env-doctor.test.cjs`
- **Aceite vinculado:** A9

## Onda 2

### T3 — OB-49: Registrar ADR D-7, sincronizar versao 1.22.2 nas 5 fontes e atualizar CHANGELOG.md

- **Arquivos prováveis:** `docs/adr/`, `docs/adr/D-1-isolamento-read-only-e-sanitizacao-centralizada-de-env-vars.md`, `docs/adr/D-2-junction-segura-de-node-modules-condicionada-a-sha-256-de-pa.md`, `docs/adr/D-3-preflight-local-5s-impacto-estatico-e2e-e-leitura-explicita.md`, `docs/adr/D-4-governanca-de-release-unificada-retomada-idempotente-pos-rei.md`, `docs/adr/D-5-core-agnostico-vs-presets-declarativos-de-dominio.md`, `docs/adr/D-6-decomposicao-strangler-fig-de-oxe-cc-e-oxe-operational.md`, `docs/adr/README.md`, `package.json`, `packages/runtime/package.json`, `vscode-extension/package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`
- **Depende de:** T1, T2
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a10-release-1222.test.cjs`
- **Aceite vinculado:** A10
