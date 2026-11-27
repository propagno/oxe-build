---
oxe_doc: spec
status: approved
---

# OXE — SPEC (oxe-build v1.22.2)

## Objetivo

Entregar a versão `1.22.2` do `oxe-build` em 3 fases (`F1`, `F2`, `F3`), incorporando todas as melhorias aprovadas do uso real no OXESpace `v1.6.3` e as correções catalogadas no bench controlado `v1.22.0 → v1.22.1`, preservando o núcleo 100% agnóstico (ADR `D-5`) e 100% de compatibilidade do SDK.

## Critérios de aceite

| ID | Critério | Risco | Como verificar |
|---|---|---|---|
| A1 | `phase_gates` suporta filtro declarativo `paths`/`globs`, `runRuntimeVerify` executa `preflight.triggers` casados com arquivos alterados e `detectGateCandidates`/`suggestPathGates` amplia cobertura agnóstica de guardas/contratos (`OXB-222-01`) | P0 | `node --test tests/acceptance/oxe-1222-a1-path-gates.test.cjs` |
| A2 | `runtime verify --json` emite payload compacto `< 4 KB` por padrão (salvando dump integral em `verify-full.json`, com `--full` opt-in e `--summary` alias), e `plan lint --json` / `status --json` omitem blocos verbosos/manifesto bruto por padrão (`OXB-222-02`) | P0 | `node --test tests/acceptance/oxe-1222-a2-compact-json.test.cjs` |
| A3 | `oxe-cc sync` cobre `electron/main/db/migrations`, suporta `sync.version_pins` para atualizar constantes de versão atomicamente e integra com `runtimePromote` (`OXB-222-03`) | P1 | `node --test tests/acceptance/oxe-1222-a3-sync-version-pins.test.cjs` |
| A4 | `plan scope add` aceita `--auto-cr` (e `--task`/`--add-file`), cria CR auditado em `changes.ndjson`, reabre tarefa concluída automaticamente se `done` e atualiza `PLAN.json` + `IMPLEMENTATION-PACK.json` atomicamente (`OXB-222-04`) | P1 | `node --test tests/acceptance/oxe-1222-a4-scope-auto-cr.test.cjs` |
| A5 | `grill --card` avisa o caminho de card, `grill promote` promove para o grill ativo, `spec check --card` encontra o grill do card e `grill import` importa fatos/perguntas/termos mantendo ramos estritamente `unconfirmed` (`OXB-222-05`) | P1 | `node --test tests/acceptance/oxe-1222-a5-grill-card-import.test.cjs` |
| A6 | `commitExactContent` usa `git update-index --index-info` único + retry em `index.lock`, `runtimeProgramClose` cacheia `complexityAlarms`, `runtime program init` retorna exit code 1 em falha, `plan build` preserva `symbols` do `role.json` + CJS `require()`, e `oxe-origin.cjs` suporta `origin.allow_no_alm_quick` (`OXB-222-06`) | P1 | `node --test tests/acceptance/oxe-1222-a6-win-cli-reliability.test.cjs` |
| A7 | `prd lint --session` valida PRD da sessão, `decision add` preserva ADRs raiz existentes, `plan lint` elimina falso `unrun_acceptance_ci` para `tests/acceptance`, `plan mutate` prioriza símbolos/diff da tarefa e `packages/runtime/tsconfig.json` define `newLine` `lf` (`OXB-222-07`) | P1 | `node --test tests/acceptance/oxe-1222-a7-session-mutate-lf.test.cjs` |
| A8 | `oxe-cc runtime scorecard --with-ci` expõe `computeLeadtimeAndCiMetrics` com `first_pass_ci_green_rate`, `ci_rework_cycles` e breakdown de leadtime por etapa, 100% offline por padrão (`OXB-222-08`) | P1 | `node --test tests/acceptance/oxe-1222-a8-scorecard-ci.test.cjs` |
| A9 | Workflows (`oxe/workflows/lean/execute.md`, `oxe/workflows/ship.md`, `oxe/templates/CONFIG.md` + wrappers sincronizados) documentam os novos comandos/chaves e `doctor --project` alerta sobre variáveis de `stripEnvPrefixes` vazadas no `process.env` (`OXB-222-09`) | P2 | `node --test tests/acceptance/oxe-1222-a9-discovery-env-doctor.test.cjs` |
| A10 | ADR `D-7` registrado, versão `1.22.2` sincronizada nas 5 fontes + `CHANGELOG.md` e todos os gates de release (`doctor --release`, `pack-check`, `sdk-types`, `scorecard`, `check-origin`) verdes (`OXB-222-10`) | P2 | `node --test tests/acceptance/oxe-1222-a10-release-1222.test.cjs` |

## Fora de escopo

- Criar chave duplicada `verify.path_gates` ou regras hardcoded por repositório.
- Implementar lock distribuído entre worktrees (`program lock`).
- Permitir auto-confirmação silenciosa de ramos no `grill import`.
- Executar `git push` ou `npm publish`.
