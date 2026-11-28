# PLAN — F5

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-12: Primer compacto do agente (oxe-primer.cjs + CLI primer + MCP oxe_primer) e Intake autonomo (oxe-deliver-intake.cjs)

- **Arquivos prováveis:** `bin/lib/oxe-primer.cjs`, `bin/lib/oxe-deliver-intake.cjs`, `bin/lib/oxe-mcp-server.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/oxe-cc.js`, `bin/lib/oxe-operational.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a12-primer-deliver-intake.test.cjs`
- **Aceite vinculado:** A12
