---
oxe_doc: spec
status: approved
---

# OXE — SPEC (oxe-build v1.22.2)

## Objetivo

Entregar a versão `1.22.2` do `oxe-build` em 4 fases (`F1`, `F2`, `F3`, `F4`), incorporando todas as melhorias aprovadas do uso real no OXESpace `v1.6.3`, as correções catalogadas no bench controlado `v1.22.0 → v1.22.1` e os gates mecânicos de qualidade de specs e cards no upstream, preservando o núcleo 100% agnóstico (ADR `D-5`), zero novas dependências externas e 100% de compatibilidade do SDK.

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
