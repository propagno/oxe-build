# PLAN — F8

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-15: Dashboard v2 Live Deliver + Entrega Pronta, workflow /oxe-deliver sincronizado e docs v1.23.0

- **Arquivos prováveis:** `bin/lib/oxe-dashboard.cjs`, `oxe/workflows/deliver.md`, `oxe/workflows/references/workflow-runtime-contracts.json`, `.github/prompts/oxe-deliver.prompt.md`, `commands/oxe/deliver.md`, `.cursor/commands/oxe-deliver.md`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/adr/D-8-ecossistema-aberto-mcp-alm-vcs-dashboard-v2-e-paridade-ci.md`, `lib/sdk/README.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a15-deliver-e2e-dashboard.test.cjs`
- **Aceite vinculado:** A15
