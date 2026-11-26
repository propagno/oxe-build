# PLAN

> Gerado por `oxe-cc plan build` a partir de F1.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-25: Resolver alm.jira.site/project em makeJiraClient (oxe-release-ops.cjs)

- **Arquivos prováveis:** `bin/lib/oxe-release-ops.cjs`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a1-jira-config.test.cjs tests/oxe-1230-lote3-release-governance.test.cjs`
- **Aceite vinculado:** A1

### T2 — OB-26: Criar .gitattributes (eol=lf para codigo/markdown/json/yml e eol=crlf para scripts Windows)

- **Arquivos prováveis:** `.gitattributes`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a2-gitattributes.test.cjs`
- **Aceite vinculado:** A2

### T3 — OB-27: Adicionar job publish-npm com OIDC provenance em release.yml e documentar em RELEASE-READINESS.md

- **Arquivos prováveis:** `.github/workflows/release.yml`, `docs/RELEASE-READINESS.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a3-release-npm.test.cjs`
- **Aceite vinculado:** A3

### T4 — OB-28: Criar bin/lib/oxe-presets.cjs, registrar preset/presets em ALLOWED_CONFIG_KEYS e documentar em CONFIG.md

- **Arquivos prováveis:** `bin/lib/oxe-presets.cjs`, `bin/lib/oxe-project-health.cjs`, `oxe/templates/CONFIG.md`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1221-a4-presets.test.cjs tests/oxe-1212-config-keys.test.cjs`
- **Aceite vinculado:** A4
