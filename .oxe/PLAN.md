# PLAN

> Gerado por `oxe-cc plan build` a partir de F1.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-62: Hardening CI/release.yml (publish-npm OIDC Node 24, retry npm view, Actions SHA-pinadas)

- **Arquivos prováveis:** `.github/workflows/release.yml`, `.github/workflows/ci.yml`
- **Depende de:** —
- **Onda:** 1
- **Tipo:** config-only
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a1-release-ci-hardening.test.cjs`
- **Aceite vinculado:** A1

## Onda 2

### T2 — OB-63: Isolamento .oxe/ em product_package no doctor e gate oxe-cc doctor --ci-parity

- **Arquivos prováveis:** `bin/lib/oxe-ci-parity.cjs`, `bin/lib/oxe-project-health.cjs`, `bin/lib/oxe-core-command-handlers.cjs`, `bin/oxe-cc.js`, `bin/lib/oxe-operational.cjs`, `lib/sdk/index.d.ts`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a2-doctor-ci-parity.test.cjs`
- **Aceite vinculado:** A2

## Onda 3

### T3 — OB-64: findGuaranteedDeadPid anti-flake PID reuse no Windows e adocao em promote-fixtures

- **Arquivos prováveis:** `bin/lib/oxe-agent-coord.cjs`, `tests/oxe-1212-promote-fixtures.test.cjs`
- **Depende de:** T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1230-a3-pid-flake-hygiene.test.cjs tests/oxe-1212-promote-fixtures.test.cjs`
- **Aceite vinculado:** A3
