# PLAN — Cobertura e testes OXE

## Onda 1 — Infraestrutura e correção de testes

### T1 — Ambiente isolado e artefactos Cursor
- **Arquivos prováveis:** `tests/isolated-home-env.cjs`, `tests/install.test.cjs`, `scripts/sync-cursor-from-prompts.cjs`, `.cursor/commands/*.md`
- **Depende de:** —
- **Onda:** 1
- **Implementação:** Helper `isolatedHomeEnv`; gerar `.cursor/commands` a partir de `.github/prompts`; garantir que o instalador encontra `PKG_ROOT/.cursor/commands`.
- **Verificar:**
  - Comando: `node --test tests/install.test.cjs`
  - Manual: `node scripts/sync-cursor-from-prompts.cjs` imprime contagem > 0
- **Aceite vinculado:** A1, A2

### T2 — c8 e scripts npm
- **Arquivos prováveis:** `package.json`
- **Depende de:** T1
- **Onda:** 1
- **Implementação:** `test:coverage`, `sync:cursor`, `prepublishOnly` com sync + testes; bloco `c8` com limiares.
- **Verificar:**
  - Comando: `npm run test:coverage`
- **Aceite vinculado:** A3, A5

## Onda 2 — Testes unitários e de subprocesso

### T3 — `bin/lib` e `lib/sdk`
- **Arquivos prováveis:** `tests/oxe-manifest.test.cjs`, `tests/oxe-agent-install.test.cjs`, `tests/oxe-install-resolve-full.test.cjs`, `tests/oxe-health-extended.test.cjs`, `tests/oxe-workflows-edge.test.cjs`, `tests/oxe-sdk-edge.test.cjs`
- **Depende de:** T2
- **Onda:** 2
- **Implementação:** Cobrir ramos restantes (manifest backup, agent-install dryRun/force, resolve perfis, health `suggestNextStep`, workflows read error, SDK `runDoctorChecks`).
- **Verificar:**
  - Comando: `npm run test:coverage`
- **Aceite vinculado:** A3

### T4 — CLI e scripts raiz
- **Arquivos prováveis:** `tests/oxe-cli-edge.test.cjs`, `tests/oxe-scripts.test.cjs`
- **Depende de:** T2
- **Onda:** 2
- **Implementação:** uninstall/update/help/dry-run/dir inexistente; `oxe-assets-scan` OK; sync script erro se prompts ausente (tmp).
- **Verificar:**
  - Comando: `npm test`
- **Aceite vinculado:** A3, A4

## Onda 3 — Estado OXE

### T5 — STATE e verificação final
- **Arquivos prováveis:** `.oxe/STATE.md`
- **Depende de:** T3, T4
- **Onda:** 3
- **Implementação:** Atualizar fase e data de scan após `test:coverage` verde.
- **Verificar:**
  - Comando: `npm run test:coverage` e `npm test`
- **Aceite vinculado:** A1–A5
