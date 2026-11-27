---
oxe_doc: spec
status: approved
---

# OXE — SPEC (oxe-build v1.22.2)

## Objetivo

Entregar a versão `1.22.2` do `oxe-build` em 9 fases (`F1`..`F9`), incorporando feedback do OXESpace `v1.6.3`, bench `v1.22.0`, gates mecânicos 9+, onboarding agnóstico, higiene segura de worktrees, velocidade/sessão unificada/modularização `D-6`, coordenação multi-agente, reavaliação contínua, `CiAdapter` multi-CI e auto-roteamento empírico de modelos, preservando núcleo agnóstico (ADR `D-5`), zero novas dependências externas e 100% de compatibilidade do SDK.

## Requisitos

| R-ID | Requisito | Versão | Critérios |
|---|---|---|---|
| R1 | Filtragem path-aware em `phase_gates` (`paths`/`globs`), disparo de `preflight.triggers` no `runtime verify` e `suggestPathGates` agnóstico (`OXB-222-01`) | v1 | A1 |
| R2 | Saída `--json` compacta (`< 4 KB`) por padrão em `runtime verify` (com `verify-full.json` e `--full`/`--summary`), `plan lint` e `status` (`OXB-222-02`) | v1 | A2 |
| R3 | Suporte a `electron/main/db/migrations`, atualização atômica de `sync.version_pins` e hook automático no `runtimePromote` (`OXB-222-03`) | v1 | A3 |
| R4 | Evolução auditada de escopo pós-CI via `plan scope add --auto-cr` com criação de CR e reabertura automática de tarefa `done` (`OXB-222-04`) | v1 | A4 |
| R5 | Aviso em `grill --card`, `grill promote --card`, `spec check --card` e `grill import --from` estritamente `unconfirmed` (`OXB-222-05`) | v1 | A5 |
| R6 | Confiabilidade Windows/CLI: `--index-info` + retry `index.lock`, cache `complexityAlarms`, exit code `1` no `program init`, `plan build` CJS/symbols e `origin.allow_no_alm_quick` (`OXB-222-06`) | v1 | A6 |
| R7 | Polimento de sessão e ferramental: `prd lint --session`, `decision add` preservando ADRs raiz, fim de `unrun_acceptance_ci` falso, `plan mutate` priorizando símbolos/diff e `newLine: lf` em `packages/runtime` (`OXB-222-07`) | v1 | A7 |
| R8 | Telemetria offline de CI e leadtime no `runtime scorecard --with-ci` (`OXB-222-08`) | v1 | A8 |
| R9 | Discovery atualizado nos workflows canônicos e aviso não-bloqueante de vazamento `stripEnvPrefixes` em `doctor --project` (`OXB-222-09`) | v1 | A9 |
| R10 | ADR `D-7` preservando `D-1..D-6`, versão `1.22.2` sincronizada nas 5 fontes e `CHANGELOG.md` atualizado (`OXB-222-10`) | v1 | A10 |
| R11 | Gates mecânicos de qualidade no upstream: validação de paths/ADRs/símbolos e coesão anti-"combo" em `alm refine lint`, e validação de profundidade (Bordas/Proibições) + paths reais em `spec check` (`OXB-222-11`) | v1 | A11 |
| R12 | Comando agnóstico `oxe-cc onboard [--json] [--write]` para onboarding read-only multi-CI, multi-ALM e multi-stack com análise de lacunas de gates (`OXB-222-12`) | v1 | A12 |
| R13 | Higiene operacional segura de worktrees: proteção de destinos de junctions NTFS em `gc-worktrees`, detecção/limpeza opcional de worktrees aninhados de agentes (`.claude/worktrees`), diagnóstico em `doctor --project` + `onboard` e hook configurável `worktree.auto_gc` no `runtimeProgramClose` (`OXB-222-13`) | v1 | A13 |
| R14 | Resolução unificada de sessão em `spec`/`program`/`prd`, helper `bin/lib/oxe-git-root.cjs` anti-`$HOME/.git` com alerta em `doctor --project`, e opt-in `verify.allow_oxe_refs` (`OXB-222-14`) | v1 | A14 |
| R15 | Execução paralela de checks read-only no `runtime verify` (`verify.concurrency` / `--concurrency`) com cache incremental seguro por fingerprint (`OXB-222-15`) | v1 | A15 |
| R16 | Decomposição Strangler Fig Fatia 2 (ADR `D-6`) extraindo runtime de `promote` e `program-close` de `oxe-operational.cjs` e comandos `spec`/`program` de `bin/oxe-cc.js` com 0 drift no SDK (`OXB-222-16`) | v1 | A16 |
| R17 | Coordenação multi-agente local via `.git/oxe/active-agents.json`, CLI `oxe-cc agents`, detecção de colisão de `write_set` e integração em `status --all-worktrees` / `plan lint` (`OXB-222-17`) | v1 | A17 |
| R18 | Reavaliação contínua `oxe-cc reevaluate [--against <ref>]` classificando drift da base sobre plano pendente em `no_impact`, `mechanical_sync` e `contract_drift` (`OXB-222-18`) | v1 | A18 |
| R19 | Modo `oxe-cc onboard --propose-config [--apply]` propondo e aplicando patch declarativo de `phase_gates`, `profile` e `worktree.auto_gc` com `--dry-run` padrão (`OXB-222-19`) | v1 | A19 |
| R20 | Camada agnóstica `CiAdapter` (`bin/lib/oxe-ci-adapter.cjs`) suportando `github`, `gitlab`, `azure-devops` e `local` integrada a `ship`/`release` (`OXB-222-20`) | v1 | A20 |
| R21 | Auto-roteamento empírico de modelos no `runtime scorecard --with-routing` e sugestão automática `suggested_model_hint` no `plan build` (`OXB-222-21`) | v1 | A21 |

## Critérios de aceite

| ID | Critério | Risco | Como verificar |
|---|---|---|---|
| A1 | `phase_gates` suporta filtro declarativo `paths`/`globs` com fallback seguro quando `changedFiles` é indisponível; `runRuntimeVerify` executa `preflight.triggers` casados com arquivos alterados; `detectGateCandidates`/`suggestPathGates` amplia cobertura agnóstica de guardas/contratos (`OXB-222-01`) | P0 | `node --test tests/acceptance/oxe-1222-a1-path-gates.test.cjs` |
| A2 | `runtime verify --json` (e `--summary`) emite payload compacto `< 4 KB` por padrão sem banner de texto, grava dump integral em `.oxe/runs/<run_id>/verify-full.json` e preserva `--full` opt-in; `plan lint --json` e `status --json` compactam blocos verbosos/manifesto bruto por padrão (`OXB-222-02`) | P0 | `node --test tests/acceptance/oxe-1222-a2-compact-json.test.cjs` |
| A3 | `oxe-cc sync` descobre `electron/main/db/migrations`, atualiza constantes declaradas em `sync.version_pins` atomicamente em dry-run e apply, e integra com `runtimePromote` (`OXB-222-03`) | P1 | `node --test tests/acceptance/oxe-1222-a3-sync-version-pins.test.cjs` |
| A4 | `plan scope add` aceita `--auto-cr`, `--task`, `--add-file` e `--session`, valida guarda de teste congelado antes de criar CR em `changes.ndjson`, reabre tarefa `done` com evento `TaskReopenedForScope` e atualiza `PLAN.json` + `IMPLEMENTATION-PACK.json` atomicamente (`OXB-222-04`) | P1 | `node --test tests/acceptance/oxe-1222-a4-scope-auto-cr.test.cjs` |
| A5 | `grill --card` emite `card_notice` orientando `grill promote` / `spec check --card`; `grill promote` promove o grill do card para o grill ativo; `spec check --card` lê o grill do card; `grill import` importa fatos/perguntas/respostas/termos mantendo ramos estritamente `unconfirmed` (`OXB-222-05`) | P1 | `node --test tests/acceptance/oxe-1222-a5-grill-card-import.test.cjs` |
| A6 | `commitExactContent` usa `git update-index --index-info` em chamada única com retry em `index.lock`, `runtimeProgramClose` cacheia `complexityAlarms`, `runtime program init` sai com código `1` em erro, `plan build` preserva `symbols` do `role.json` + CJS `require()`, e `origin.allow_no_alm_quick` libera apenas quicks registrados em `.oxe/quicks.ndjson` (`OXB-222-06`) | P1 | `node --test tests/acceptance/oxe-1222-a6-win-cli-reliability.test.cjs` |
| A7 | `prd lint --session` valida PRD da sessão, `decision add` preserva ADRs raiz `D-1..D-N`, `plan lint` elimina falso `unrun_acceptance_ci` para `tests/acceptance` cobertos por `node --test`/`quality-check.cjs`, `plan mutate` prioriza símbolos/diff da tarefa e `packages/runtime/tsconfig*.json` define `newLine: "lf"` (`OXB-222-07`) | P1 | `node --test tests/acceptance/oxe-1222-a7-session-mutate-lf.test.cjs` |
| A8 | `runtime scorecard --with-ci` anexa `ci_telemetry` via `computeLeadtimeAndCiMetrics` (`offline: true`, `first_pass_ci_green_rate`, `ci_rework_cycles`, `total_ci_runs`, `phases_with_ci`, `leadtime_breakdown`, `by_phase`) sem alterar o contrato padrão sem a flag (`OXB-222-08`) | P1 | `node --test tests/acceptance/oxe-1222-a8-scorecard-ci.test.cjs` |
| A9 | `checkProjectEnvironment` (`doctor --project`) reporta `leaked_env` (somente nomes) e emite aviso não-bloqueante quando variáveis coincidem com `stripEnvPrefixes`; `oxe/workflows/lean/execute.md`, `oxe/workflows/ship.md` e `oxe/templates/CONFIG.md` documentam as novas capacidades da `1.22.2` com wrappers sincronizados (`OXB-222-09`) | P2 | `node --test tests/acceptance/oxe-1222-a9-discovery-env-doctor.test.cjs` |
| A10 | ADR `D-7` existe em `docs/adr/` preservando `D-1..D-6`, versão `1.22.2` está sincronizada nas 5 fontes + `CHANGELOG.md` e `inspectReleaseReadiness` reporta `manifest.versions.rootPackage.version === "1.22.2"` com zero blockers de divergência de versão (`OXB-222-10`) | P2 | `node --test tests/acceptance/oxe-1222-a10-release-1222.test.cjs` |
| A11 | `lintSpec` (quando recebe `projectRoot`) reprova paths inexistentes citados em `Referências`/`Arquitetura e fluxo`, alerta símbolos citados como existentes ausentes no arquivo e alerta cards `story`/`task` "combo" pouco coesos; `checkSpec` alerta SPEC sem seção de Bordas/Proibições, critérios sobrecarregados e paths de documentação/workflow inexistentes no disco (`OXB-222-11`) | P1 | `node --test tests/acceptance/oxe-1222-a11-spec-card-quality.test.cjs` |
| A12 | Comando `onboard` (`--json` / `--write`) gera dossiê 100% read-only e agnóstico detectando CI (GitHub/GitLab/Azure/Bitbucket/CircleCI/Jenkins/none), ALM (Jira/Azure DevOps/none), stack, `leaked_env` e lacunas vs `phase_gates`, sem vazar segredos (`OXB-222-12`) | P1 | `node --test tests/acceptance/oxe-1222-a12-agnostic-onboard.test.cjs` |
| A13 | `gcWorktrees` protege destinos de junctions usados por worktrees mantidas (`junction_target_in_use`), desfaz junctions rasas antes de remover e suporta worktrees aninhados (`--include-nested`/`--ignore-agent-settings`); `doctor --project` e `onboard` reportam `worktrees` e avisam excesso; `runtimeProgramClose` aplica `worktree.auto_gc` (`warn`/`prune`/`apply`/`false`) (`OXB-222-13`) | P1 | `node --test tests/acceptance/oxe-1222-a13-worktree-hygiene.test.cjs` |
| A14 | Comandos `spec`/`program`/`prd` resolvem a sessão ativa unificadamente; `resolveProjectGitRoot` bloqueia herança de `$HOME/.git` e `doctor --project` alerta o risco; `verify.allow_oxe_refs: true` evita falso positivo em `oxe_internal_reference` (`OXB-222-14`) | P1 | `node --test tests/acceptance/oxe-1222-a14-session-gitroot-oxerefs.test.cjs` |
| A15 | `executeSuite`/`runRuntimeVerify` suportam pool paralelo (`concurrency`) preservando ordem determinística dos resultados e cache incremental por fingerprint que reutiliza apenas passes verdes válidos e nunca cacheia falhas (`OXB-222-15`) | P1 | `node --test tests/acceptance/oxe-1222-a15-parallel-verify.test.cjs` |
| A16 | Fatia 2 `D-6` extrai `bin/lib/operational/promote-runtime.cjs` e `bin/lib/commands/spec-program-commands.cjs`, reduzindo `oxe-operational.cjs` em `>= 800` linhas e `bin/oxe-cc.js` em `>= 250` linhas sem ciclos nem drift de SDK (`OXB-222-16`) | P1 | `node --test tests/acceptance/oxe-1222-a16-strangler-slice2.test.cjs` |
| A17 | `oxe-agent-coord.cjs` + CLI `oxe-cc agents` gerenciam leases e inbox em `.git/oxe/`, expiram leases obsoletos, detectam colisões de `write_set` no `plan lint` e exibem agentes ativos em `status --all-worktrees` (`OXB-222-17`) | P1 | `node --test tests/acceptance/oxe-1222-a17-agent-coord.test.cjs` |
| A18 | `oxe-reevaluate.cjs` + CLI `oxe-cc reevaluate` (`--against`, `--json`) classificam tarefas pendentes contra commits da base em `no_impact`, `mechanical_sync` e `contract_drift` com sugestão acionável de `sync` ou CR (`OXB-222-18`) | P1 | `node --test tests/acceptance/oxe-1222-a18-reevaluate.test.cjs` |
| A19 | `proposeOnboardingConfig` + `oxe-cc onboard --propose-config` geram patch declarativo de `phase_gates`/`worktree.auto_gc` em `--dry-run` padrão (0 escritas) e mesclam de forma não-destrutiva com `--apply` (`OXB-222-19`) | P1 | `node --test tests/acceptance/oxe-1222-a19-onboard-propose.test.cjs` |
| A20 | `oxe-ci-adapter.cjs` (`resolveCiAdapter`) abstrai `github`, `gitlab`, `azure-devops` e `local` para PR/MR, runs de CI e assets de release com fallback offline limpo integrado a `ship`/`release` (`OXB-222-20`) | P1 | `node --test tests/acceptance/oxe-1222-a20-ci-adapter.test.cjs` |
| A21 | `computeModelRoutingStats` + `scorecard --with-routing` calculam estatísticas por categoria de tarefa offline e `plan build` anota `suggested_model_hint` respeitando `model_hint` explícito do usuário (`OXB-222-21`) | P1 | `node --test tests/acceptance/oxe-1222-a21-model-routing.test.cjs` |

## Contratos observáveis (I/O e casos de erro)

1. **`runtime verify --json` / `--summary` (`A2`):**
   - Saída padrão: JSON compacto `< 4 KB` com `oxeRuntimeVerifySchema: 2`, `compact: true`, `ok`, `exit_code` (`0` pass, `1` fail, `2` blocked), `run_id`, `status`, `summary`, `checks_summary`, `coverage_percent`, `tampered`, `gates`, `regression`, `gaps`, `failures`, `verify_md`, `full_report_path`.
   - Caso de erro/falha: `failures` mantém mensagens acionáveis truncadas; o relatório completo é sempre gravado em `.oxe/runs/<run_id>/verify-full.json`; `--full` emite o payload integral retrocompatível no stdout.
2. **`phase_gates` path-aware (`A1`):**
   - Cada gate aceita `paths` ou `globs` (array de strings normalizadas com `/`).
   - Quando `changedFiles` é `null`/`undefined` (ex.: `git diff` indisponível ou repo sem base), o gate **executa** (fallback conservador — nunca cria falso verde).
   - Quando `changedFiles` é um array não-vazio e nenhum caminho casa, o gate é omitido.
3. **`sync.version_pins` (`A3`):**
   - Schema: `[{ file: string, pattern: string, label?: string, source?: "max_migration" }]`.
   - Regex inválida em `pattern` é reportada como erro/aviso sem corromper o arquivo alvo; se o arquivo alvo não existir ou o padrão não casar, reporta aviso e mantém o arquivo intacto; em múltiplos matches no mesmo arquivo, aplica substituições em ordem reversa de offset para não corromper índices.
4. **`runtime scorecard --with-ci` (`A8`):**
   - Sem `--with-ci`: campo `ci_telemetry` é `undefined` (contrato v1 intacto).
   - Com `--with-ci`: anexa `ci_telemetry` com `{ offline: true, total_ci_runs, phases_with_ci, first_pass_ci_green_rate, ci_rework_cycles, leadtime_breakdown: { avg_plan_to_verify_ms, avg_verify_to_close_ms, avg_total_ms, post_verify_share_pct, phases_measured }, by_phase }`.
   - Caso de borda: quando `phases_with_ci === 0`, `first_pass_ci_green_rate` é `null` (nunca `NaN`) e `ci_rework_cycles` é `0`.
5. **`doctor --project` `stripEnvPrefixes` (`A9`):**
   - Retorno inclui `leaked_env: string[]` (apenas nomes ordenados; **nunca** valores de variáveis).
   - Quando `leaked_env.length > 0`, adiciona aviso acionável em `warnings` citando nomes e `stripEnvPrefixes`, mantendo `ok: problems.length === 0` (não-bloqueante).
6. **Gates mecânicos de specs e cards (`A11`):**
   - `oxe-alm-refine.lintSpec(md, kind, { projectRoot, artifacts })`:
     - Em `## Referências` e `## Arquitetura e fluxo`, paths de arquivos do repositório citados em crases (ex.: `docs/adr/...`, `.oxe/...`, `bin/...`, `oxe/...`, `src/...`, `packages/...`, `scripts/...`, `lib/...`) que não existem em `projectRoot` — excluindo globs (`*`), templates (`<...>`) e itens explicitamente marcados `(novo)`/`(criar)`/`a criar` — geram **erro** bloqueante (`referência inexistente no repositório: \`<path>\``).
     - Quando uma linha associa um arquivo existente a um símbolo citado como já existente (padrão `` `path/arquivo.cjs` (`simbolo`) `` sem verbos de criação como `criar`/`adicionar`/`exportar`/`implementar`/`novo`) e o símbolo não ocorre no conteúdo do arquivo, gera **aviso** (`símbolo \`<simbolo>\` não encontrado em \`<path>\``).
     - Para `story` e `task` (nunca `epic`): título `> 120` caracteres enumerando 4+ frentes, ou `>= 5` arquivos distintos em `Referências` (`Código:`), ou critério `CA-n` unindo duas proposições independentes com `; e ` gera **aviso** de coesão (`coesão/granularidade: …`).
   - `oxe-spec-check.checkSpec(input)`:
     - Quando `SPEC.md` possui critérios `A*` mas não possui seção `## Bordas` / `## Proibições` / `## Restrições` / `## Contratos`, gera **aviso** acionável.
     - Quando um critério `A*` excede `320` caracteres com múltiplas cláusulas independentes, gera **aviso** de sobrecarga de critério.
     - Quando `input.projectRoot` é fornecido e `SPEC.md` cita paths em crases de `docs/adr/*.md`, `oxe/workflows/...` ou `oxe/templates/...` ausentes no disco (sem marcação de novo), gera **erro** (`referência inexistente na SPEC: \`<path>\``).
7. **Onboarding agnóstico `oxe-cc onboard` (`A12`):**
   - Modo padrão e `--json`: **estritamente read-only e offline** (0 arquivos criados/modificados no disco, 0 chamadas de rede, 0 vazamento de valores de credenciais/tokens — apenas nomes de env vars e booleano `present`).
   - Modo `--write`: grava `.oxe/ONBOARDING.md` (opt-in explícito).
   - Detecta automaticamente provedor(es) de CI (`github-actions`, `gitlab-ci`, `azure-pipelines`, `bitbucket-pipelines`, `circleci`, `jenkins`, ou `none`), provedor de ALM (`jira`, `azure-devops`, `none`, ou provedor customizado declarado), stack(s) (`node`, `python`, `go`, `rust`, `java`, `dotnet`, `legacy`), políticas de `delivery`/`origin`/`sync.version_pins` e compara checks do CI contra `phase_gates` / `preflight.triggers` locais.
   - Emite `oxeOnboardSchema: 1` com `ok`, `read_only`, `project`, `oxe`, `environment`, `ci`, `alm`, `delivery`, `rules`, `gaps` e `prompt_markdown`.
8. **Higiene operacional segura de worktrees (`A13`):**
   - `gcWorktrees(projectRoot, options)` em `bin/lib/oxe-worktree-gc.cjs`:
     - Antes de aprovar candidatos, varre junctions/symlinks (profundidade `<= 3`) de todas as worktrees **mantidas** (principal, corrente, `locked`, `dirty`, `not_merged`). Qualquer worktree candidata cujo diretório (ou subdiretório, ex.: `node_modules`) seja alvo de junction ativa é movida para `skipped` com `{ reason: "junction_target_in_use", dependents: [...] }` (fecho transitivo).
     - Ao remover (`--apply`), desfaz **todas** as junctions/symlinks rasas (`<= 3`) dentro da worktree antes de `git worktree remove`/deleção, preservando 100% os arquivos do destino.
     - Com `--include-nested` (`includeNested: true`), inclui worktrees aninhados de agentes (ex.: `.claude/worktrees/*`) e com `--ignore-agent-settings` (`ignoreAgentSettings: true`), aceita como elegíveis worktrees já mergeados cuja única modificação pendente seja `.claude/settings.local.json`.
     - Cada candidato reporta `has_real_node_modules: boolean` e `nested_agent: boolean`.
   - `summarizeWorktreeHygiene(projectRoot, options)` (100% read-only, não-lançador fora de git) retorna `{ ok, git_repo, base, total, secondary, clean_merged, prunable, dirty, not_merged, protected_junction_targets, nested_agent, with_real_node_modules, warn_above, needs_gc, protected_details }`.
   - `checkProjectEnvironment` (`doctor --project`) anexa `worktrees` ao JSON e adiciona aviso não-bloqueante em `warnings` quando `needs_gc === true` (respeitando `worktree.warn_above`, padrão `5`, e `worktree.hygiene: false` para silenciar). `buildOnboardingPack` (`onboard`) espelha `environment.worktrees` e inclui gap acionável quando `needs_gc === true`.
   - `runtimeProgramClose` respeita `worktree.auto_gc` (`"warn"` padrão = apenas resumo read-only em `worktree_hygiene`; `"prune"` = executa `git worktree prune`; `"apply"` = executa `gcWorktrees(..., { mergedOnly: true, apply: true })` respeitando proteção de junctions; `false` = desativado).
9. **Sessão única, `resolveProjectGitRoot` e `verify.allow_oxe_refs` (`A14`):**
   - `resolveEffectiveSession(projectRoot, explicitSession)` resolve sessão explícita ou ativa em `.oxe/SESSIONS.md` para `spec`, `program` e `prd`; `resolveRuntimeArtifactPathsRaw` verifica `sessionRoot/SPEC.md` e `sessionRoot/ROADMAP.md` antes de `sessionRoot/spec/...`.
   - `bin/lib/oxe-git-root.cjs` exporta `resolveProjectGitRoot(projectRoot, options)` (retorna `null` quando o top-level herdado é `os.homedir()` ou fora de `os.tmpdir()` para diretórios temporários) e `detectHomeGitHazard(projectRoot, options)`.
   - `verification-compiler.ts` aceita `allowOxeRefs?: boolean` (lido de `verify.allow_oxe_refs === true`).
10. **Pool paralelo e cache incremental no `runtime verify` (`A15`):**
    - `executeSuite` / `verifyRun` aceitam `concurrency?: number` e `regressionCache?: Map<string, CheckResult>`; executam checks independentes concorrentemente preservando a ordem original de `suite.checks`.
    - `bin/lib/oxe-verify-cache.cjs` persiste passes verdes em `.oxe/runs/verify-regression-cache.json` por `(check_id, command, tree_fingerprint)`; nunca reutiliza falhas ou checks com arquivos congelados adulterados.
11. **Decomposição Strangler Fig Fatia 2 (`A16`):**
    - Extrai `bin/lib/operational/promote-runtime.cjs` de `bin/lib/oxe-operational.cjs` (`>= 800` linhas reduzidas) e `bin/lib/commands/spec-program-commands.cjs` de `bin/oxe-cc.js` (`>= 250` linhas reduzidas), com 0 ciclos e `check:sdk-types` verde.
12. **Coordenação multi-agente local (`A17`):**
    - `bin/lib/oxe-agent-coord.cjs` grava leases em `<git-common-dir>/oxe/active-agents.json` e mensagens em `<git-common-dir>/oxe/agent-messages.ndjson`, expira leases com TTL/PID morto, detecta colisões de `write_set` em `detectWriteSetCollisions` (exposto no `plan lint` e `status --all-worktrees`) e CLI `oxe-cc agents`.
13. **Reavaliação contínua (`A18`):**
    - `bin/lib/oxe-reevaluate.cjs` (`reevaluateAgainstBase`) e CLI `oxe-cc reevaluate [--against <ref>] [--json]` comparam diff da base contra tarefas pendentes e classificam cada tarefa em `no_impact`, `mechanical_sync` ou `contract_drift` com recomendação acionável.
14. **`onboard --propose-config` (`A19`):**
    - `proposeOnboardingConfig(projectRoot, options)` produz `{ dry_run, applied, proposed_patch, added_gates, config_path }`; `--dry-run` (padrão) não grava nada; `--apply` faz merge não-destrutivo em `.oxe/config.json`.
15. **`CiAdapter` multi-CI (`A20`):**
    - `bin/lib/oxe-ci-adapter.cjs` (`resolveCiAdapter`, `detectCiProvider`, `inspectCiStatus`, `listReleaseAssets`) suporta `github`, `gitlab`, `azure-devops` e `local` (100% offline sem `gh`).
16. **Auto-roteamento empírico de modelos (`A21`):**
    - `computeModelRoutingStats` e `suggestModelHint` em `bin/lib/oxe-scorecard.cjs` analisam eventos/uso offline por categoria de tarefa; `runtime scorecard --with-routing` anexa `model_routing`; `oxe-plan-build.cjs` anota `suggested_model_hint` preservando `model_hint` explícito.

## Bordas e proibições

- **Proibido acoplamento a repositórios específicos (ADR `D-5`):** nenhum caminho ou nome de produto específico (ex.: OXESpace) pode entrar como regra hardcoded em `phase_gates`, `sync.version_pins`, `lintSpec` ou `checkSpec`.
- **Proibido criar falso verde em fallback:** falha ao obter `git diff` em `phase_gates` deve executar o gate; falha de `lintSpec` com path inexistente em `Referências` deve bloquear `alm refine lint`/`apply` quando `projectRoot` é conhecido.
- **Proibido vazar segredos em logs/JSON:** `doctor --project` (`leaked_env` e `scrubbed_env`) só pode emitir nomes de variáveis, nunca valores.
- **Proibido auto-confirmar decisões humanas:** `grill import` deve ignorar e descartar qualquer evento `confirm`/`confirmed`/`close`/`closed` no arquivo de entrada; `origin.allow_no_alm_quick` nunca pode liberar commits sem registro válido em `.oxe/quicks.ndjson`.
- **Proibido quebrar retrocompatibilidade do SDK ou Node 18:** `bin/lib/oxe-operational.cjs` preserva `>= 209` exports, `npm run test:sdk-types` deve passar com 0 drift e `engines.node >= 18.0.0`.
- **Proibido executar `git push`, `npm publish` ou `--no-verify`** durante o fluxo local.

## Suposições

- Os projetos consumidores que usam `phase_gates` com `paths` executam `oxe-cc` dentro de um repositório Git válido (e quando não estão, o fallback conservador roda os gates normalmente).
- O `runtime scorecard --with-ci` opera 100% offline sobre registros locais (`.oxe/**/ci.ndjson` e eventos); coleta remota via API do GitHub fica fora de escopo nesta versão.
- Cards históricos já encerrados (`Done`) com múltiplos sub-itens (`OB-45`, `OB-46`) têm seus critérios de aceite reorganizados de forma atômica (`CA-1..CA-5`) sem exclusão de histórico do Jira; novos cards passam a ser validados pelo aviso de coesão de `A11`.

## Fora de escopo

- Criar chave duplicada `verify.path_gates` ou regras hardcoded por repositório.
- Implementar lock distribuído entre worktrees (`program lock`).
- Permitir auto-confirmação silenciosa de ramos no `grill import`.
- Executar `git push` ou `npm publish`.
