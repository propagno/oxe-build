# PLAN

> Gerado por `oxe-cc plan build` a partir de F7.role.json. A fonte é o PLAN.json; este arquivo é a leitura humana.

## Onda 1

### T1 — OB-53: Sessao unificada em spec/program/prd, resolveProjectGitRoot anti-HOME/.git e verify.allow_oxe_refs

- **Arquivos prováveis:** `bin/lib/oxe-git-root.cjs`, `bin/lib/oxe-project-env.cjs`, `bin/lib/oxe-worktree-gc.cjs`, `bin/lib/oxe-origin.cjs`, `bin/lib/oxe-preflight.cjs`, `bin/lib/oxe-onboard.cjs`, `bin/lib/oxe-operational.cjs`, `packages/runtime/src/verification/verification-compiler.ts`
- **Depende de:** —
- **Onda:** 1
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a14-session-gitroot-oxerefs.test.cjs`
- **Aceite vinculado:** A14

## Onda 2

### T2 — OB-54: Pool paralelo de regressao no runtime verify (verify.concurrency) e cache incremental seguro

- **Arquivos prováveis:** `bin/lib/oxe-verify-cache.cjs`, `bin/lib/oxe-operational.cjs`, `packages/runtime/src/verification/verification-compiler.ts`
- **Depende de:** T1
- **Onda:** 2
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a15-parallel-verify.test.cjs`
- **Aceite vinculado:** A15

## Onda 3

### T3 — OB-55: Decomposicao Strangler Fig Fatia 2 (ADR D-6) de oxe-operational.cjs e bin/oxe-cc.js

- **Arquivos prováveis:** `bin/lib/operational/promote-runtime.cjs`, `bin/lib/commands/spec-program-commands.cjs`, `bin/lib/oxe-operational.cjs`, `bin/oxe-cc.js`, `lib/sdk/index.d.ts`
- **Depende de:** T1, T2
- **Onda:** 3
- **Verificar:**
  - Comando: `node --test tests/acceptance/oxe-1222-a16-strangler-slice2.test.cjs tests/acceptance/oxe-1221-a8-cli-commands-extract.test.cjs tests/acceptance/oxe-1221-a9-operational-slice1.test.cjs`
- **Aceite vinculado:** A16
