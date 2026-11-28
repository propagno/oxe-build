# PLAN — F11

> Gerado por `oxe-cc plan build` a partir de role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OXB-230-18: SDK Facade createClient (lib/sdk/client.cjs), ESM nativo (lib/sdk/index.mjs), exports/tipos (0 drift) e docs finais 1.23.0

- **Arquivos prováveis:** `lib/sdk/client.cjs`, `lib/sdk/index.cjs`, `lib/sdk/index.mjs`, `lib/sdk/index.types.ts`, `lib/sdk/index.d.ts`, `package.json`, `eslint.config.cjs`, `lib/sdk/README.md`, `CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/adr/D-8-ecossistema-aberto-mcp-alm-vcs-dashboard-v2-e-paridade-ci.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a18-sdk-client-esm.test.cjs && npm run test:sdk-types`
- **Aceite vinculado:** A18
