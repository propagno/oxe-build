# PLAN — F6

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-13: Motor deterministico oxe-deliver-engine.cjs (anti-cheat SHA-256, auto-cura, circuit breaker), CLI oxe-cc deliver e tools MCP oxe_deliver_*

- **Arquivos prováveis:** `bin/lib/oxe-deliver-engine.cjs`, `bin/lib/oxe-mcp-server.cjs`, `bin/lib/commands/ops-commands.cjs`, `bin/lib/oxe-operational.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a13-deliver-engine-mcp.test.cjs`
- **Aceite vinculado:** A13
