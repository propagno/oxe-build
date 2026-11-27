# PLAN

> Gerado por `oxe-cc plan build` a partir de F3.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-68: Servidor MCP stdio nativo (oxe-mcp-server.cjs, CLI oxe-cc mcp, SDK runtimeMcpServer)

- **Arquivos prováveis:** `bin/lib/oxe-mcp-server.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/oxe-cc.js`, `bin/lib/oxe-operational.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a7-mcp-server.test.cjs`
- **Aceite vinculado:** A7

## Onda 2

### T2 — OB-69: Adapters ALM nativos github-issues (gh) e gitlab-issues (glab)

- **Arquivos prováveis:** `bin/lib/oxe-alm-vcs.cjs`, `bin/lib/oxe-alm.cjs`, `bin/lib/oxe-onboard.cjs`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a8-alm-vcs-providers.test.cjs`
- **Aceite vinculado:** A8
