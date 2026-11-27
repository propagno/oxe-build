# PLAN

> Gerado por `oxe-cc plan build` a partir de F4.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-70: Dashboard v2 multi-agente ao vivo com navegacao completa e /api/state

- **Arquivos prováveis:** `bin/lib/oxe-dashboard.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a9-dashboard-v2.test.cjs tests/oxe-dashboard.test.cjs`
- **Aceite vinculado:** A9

## Onda 2

### T2 — OB-71: Strangler Fig Fatia 3 (D-6) — extracao de plan-lint-runtime.cjs e status-doctor-commands.cjs

- **Arquivos prováveis:** `bin/lib/operational/plan-lint-runtime.cjs`, `bin/lib/commands/status-doctor-commands.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a10-strangler-slice3.test.cjs`
- **Aceite vinculado:** A10

## Onda 3

### T3 — OB-72: ADR D-8, corte de versao 1.23.0 nas 5 fontes + CHANGELOG + workflows/wrappers

- **Arquivos prováveis:** `docs/adr/D-8-ecossistema-aberto-mcp-alm-vcs-dashboard-v2-e-paridade-ci.md`, `docs/adr/README.md`, `package.json`, `package-lock.json`, `packages/runtime/package.json`, `vscode-extension/package.json`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, `bin/oxe-cc.js`, `oxe/templates/CONFIG.md`, `oxe/workflows/help.md`, `oxe/workflows/ship.md`, `oxe/workflows/lean/execute.md`, `oxe/workflows/compact/**`, `oxe/workflows/compact/plan.md`, `oxe/workflows/compact/spec.md`, `.github/prompts/**`, `.github/prompts/oxe-alm.prompt.md`, `.github/prompts/oxe-ask.prompt.md`, `.github/prompts/oxe-capabilities.prompt.md`, `.github/prompts/oxe-checkpoint.prompt.md`, `.github/prompts/oxe-compact.prompt.md`, `.github/prompts/oxe-dashboard.prompt.md`, `.github/prompts/oxe-debug.prompt.md`, `.github/prompts/oxe-discuss.prompt.md`, `.github/prompts/oxe-execute.prompt.md`, `.github/prompts/oxe-forensics.prompt.md`, `.github/prompts/oxe-help.prompt.md`, `.github/prompts/oxe-loop.prompt.md`, `.github/prompts/oxe-milestone.prompt.md`, `.github/prompts/oxe-next.prompt.md`, `.github/prompts/oxe-obs.prompt.md`, `.github/prompts/oxe-plan-agent.prompt.md`, `.github/prompts/oxe-plan.prompt.md`, `.github/prompts/oxe-project.prompt.md`, `.github/prompts/oxe-quick.prompt.md`, `.github/prompts/oxe-research.prompt.md`, `.github/prompts/oxe-retro.prompt.md`, `.github/prompts/oxe-review-pr.prompt.md`, `.github/prompts/oxe-route.prompt.md`, `.github/prompts/oxe-scan.prompt.md`, `.github/prompts/oxe-security.prompt.md`, `.github/prompts/oxe-session.prompt.md`, `.github/prompts/oxe-ship.prompt.md`, `.github/prompts/oxe-skill.prompt.md`, `.github/prompts/oxe-spec.prompt.md`, `.github/prompts/oxe-ui-review.prompt.md`, `.github/prompts/oxe-ui-spec.prompt.md`, `.github/prompts/oxe-update.prompt.md`, `.github/prompts/oxe-validate-gaps.prompt.md`, `.github/prompts/oxe-verify.prompt.md`, `.github/prompts/oxe-workstream.prompt.md`, `.github/prompts/oxe.prompt.md`, `commands/oxe/**`, `commands/oxe/alm.md`, `commands/oxe/ask.md`, `commands/oxe/capabilities.md`, `commands/oxe/checkpoint.md`, `commands/oxe/compact.md`, `commands/oxe/dashboard.md`, `commands/oxe/debug.md`, `commands/oxe/discuss.md`, `commands/oxe/execute.md`, `commands/oxe/forensics.md`, `commands/oxe/help.md`, `commands/oxe/loop.md`, `commands/oxe/milestone.md`, `commands/oxe/next.md`, `commands/oxe/obs.md`, `commands/oxe/oxe.md`, `commands/oxe/plan-agent.md`, `commands/oxe/plan.md`, `commands/oxe/project.md`, `commands/oxe/quick.md`, `commands/oxe/research.md`, `commands/oxe/retro.md`, `commands/oxe/review-pr.md`, `commands/oxe/route.md`, `commands/oxe/scan.md`, `commands/oxe/security.md`, `commands/oxe/session.md`, `commands/oxe/ship.md`, `commands/oxe/skill.md`, `commands/oxe/spec.md`, `commands/oxe/ui-review.md`, `commands/oxe/ui-spec.md`, `commands/oxe/update.md`, `commands/oxe/validate-gaps.md`, `commands/oxe/verify-audit.md`, `commands/oxe/verify.md`, `commands/oxe/workflow-authoring.md`, `commands/oxe/workstream.md`, `tests/acceptance/oxe-1222-a10-release-1222.test.cjs`
- **Depende de:** T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a11-release-1230.test.cjs tests/acceptance/oxe-1222-a10-release-1222.test.cjs tests/acceptance/oxe-1221-a12-release-1221.test.cjs`
- **Aceite vinculado:** A11
