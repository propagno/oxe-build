# Changelog — OXE CLI (`oxe-cc`)

Todas as versões seguem [Semantic Versioning](https://semver.org/). As mudanças mais recentes aparecem primeiro.

---

## [1.4.0] — 2026-04-20

### Runtime Publication Stabilization

- `execute` e `verify` passaram a documentar e propagar o contrato `runtime-first`, com fallback legado explícito quando o runtime enterprise não estiver disponível
- `runtime gates` ganhou superfície operacional estável com `list`, `show`, `resolve`, filtros (`--run`, `--status`, `--scope`, `--task`) e `--json`
- `status --json` e `runtime status --json` consolidam `runtimeMode`, `fallbackMode`, `gateQueue`, `policyCoverage`, `promotionReadiness`, `recoveryState`, `multiAgent` e `providerCatalog`
- dashboard web passou a expor cards operacionais para gates, recovery, promotion e multi-agent, incluindo resolução de gates pela UI
- replay/recovery ficaram orientados a incidente com saída estruturada, reconciliação de run state e summaries derivados
- `multi-agent` foi endurecido como GA apenas sobre workspaces isolados reais; modos `parallel`, `competitive` e `cooperative` falham explicitamente em `inplace`
- SDK ampliado com `GateQueueSnapshot`, `replayRuntimeState`, `readRuntimeMultiAgentStatus` e alias `multiAgentStatus`

### Release Preparation

- alinhamento de versão para `1.4.0` em `package.json`, `package-lock.json`, `packages/runtime/package.json`, `vscode-extension/package.json`, banner e README
- alinhamento de licença da extensão VS Code com o pacote principal e inclusão de `vscode-extension/LICENSE` para empacotamento limpo do VSIX
- licença do projeto alterada de `GPL-3.0` para `MIT`, com manifests e documentação pública alinhados
- README atualizado para refletir o momento atual do produto, o contrato estável de publicação e a superfície enterprise do CLI/runtime
- `lib/sdk/README.md` e `AGENTS.md` atualizados para refletir os bridges do runtime enterprise e o comportamento `runtime-first`

### Validation

- suíte root + runtime continua verde
- scanner de assets/markdown continua íntegro

---

## [1.3.0] — 2026-04-20

### Reasoning Contracts & Semântica Multi-Runtime

- Contratos de raciocínio v2.0.0 (`oxe_contract_version: 2.0.0`) em todos os workflows e wrappers de runtime
- Novos campos de metadata: `oxe_reasoning_mode`, `oxe_question_policy`, `oxe_output_contract`, `oxe_tool_profile`, `oxe_confidence_policy`, `oxe_context_tier`
- `oxe_semantics_hash` (SHA-256 16 chars) para detecção de drift semântico entre IDEs
- Módulo `bin/lib/oxe-runtime-semantics.cjs` gerencia o contrato canônico: `buildReasoningContractBlock()`, `buildContextTiers()`, `auditRuntimeTargets()`, `computeSemanticsHash()`
- `auditRuntimeTargets()` varre Copilot prompts, commands e Cursor commands e reporta divergências entre wrappers e o contrato canônico
- Prompts e commands sincronizados para todos os runtimes: Cursor, GitHub Copilot, Claude Code, OpenCode, Codex, Gemini CLI, Windsurf, Antigravity

### Novos Módulos bin/lib

- **`oxe-dashboard.cjs`** — servidor HTTP local (porta 9000), `loadDashboardContext()`, API REST com `/api/health/status`, `/api/plan/info`, `/api/runtime/gates/{id}/status`, `/api/runtime/gates/resolve`; suporte a PLAN-REVIEW.md com comentários e status de aprovação
- **`oxe-runtime-semantics.cjs`** — gestão de metadados de workflow e contratos de raciocínio: `getWorkflowContract()`, `getAllWorkflowContracts()`, `validateWorkflowContractsRegistry()`, `buildContextPackPaths()`, `buildReasoningContractBlock()`, `splitFrontmatter()`, `parseFrontmatterMap()`
- **`oxe-operational.cjs`** expandido — monitoramento de agents, gates, evidências e estado de run com maior granularidade
- **`oxe-project-health.cjs`** expandido — métricas de saúde: test scores, coverage, violations, integração Copilot

### Comandos e Superfície

- **`oxe-ship`** — cria commit local guiado por `SPEC.md`, `PLAN.md` e `VERIFY.md`; disponível em todos os runtimes suportados
- **`oxe-skill`** — gestão e composição de skills com roles `@executor` e `@researcher`
- Contrato de raciocínio declarado em todos os workflows: `discovery`, `planning`, `execution`, `review`, `status`
- Regra pack-first em todos os wrappers: lê `.oxe/context/packs/<slug>.md` antes de cair para leitura direta

### Testes e Cobertura

- Novos testes unitários para `oxe-runtime-semantics.cjs`: 31 testes cobrindo todas as 19 funções exportadas
- Novos testes para `oxe-plugins.cjs`: 28 testes para `loadPlugins`, `runHook`, `validatePlugins`, `initPluginsDir`, `resolvePluginSources`
- Novos testes para `oxe-security.cjs`: `checkPathSafety`, `scanFileForSecrets`, `scanDirForSecretFiles`, `validatePlanPaths`
- Cobertura de linhas: **80.28% → 82.28%** (superando threshold de 82%)
- Total: **383 testes** passando (root + runtime)

---

## [1.2.1] — 2026-04-18

### Branding, Semântica e Empacotamento

- remove referências remanescentes ao framework legado dos workflows e do diagnóstico de integração Copilot
- alinha `package.json`, `package-lock.json`, banner CLI e README para `1.2.1`
- corrige deriva semântica do workflow `ship`, registrando-o no contrato canônico multi-runtime
- adiciona prompt files de `ship` para Copilot/Cursor
- remove o comando `auto` da superfície pública do OXE
- remove o comando `intel` da superfície pública do OXE
- reposiciona `ship` para fechar o ciclo com commit local guiado por `SPEC.md`, `PLAN.md` e `VERIFY.md`

---

## [1.2.0] — 2026-04-18

### Runtime Hardening & Robustez (Fases 1–9)

**Fase 1 — Runtime Hardening**

- `RunJournal` persistido em `.oxe/runs/{runId}/journal.json`: gravado a cada onda, atualizado no pause/cancel
- `Scheduler.pause()` agora grava journal e retorna `status: 'paused'` em vez de apenas setar flag in-memory
- `Scheduler.recover(runId, ctx, graph)` — retoma run pausado pelo journal; pula nós já completados
- `Scheduler.getJournal()` e `Scheduler.loadJournal(projectRoot, runId)` para inspeção
- `RunState` expandido: `retryCounts`, `policyDecisions`, `pendingGates`, `resolvedGates`, `verificationStatus`, `evidenceRefs`, `toolFailures`
- Reducer: handlers para `RetryScheduled`, `PolicyEvaluated`, `GateRequested`, `GateResolved`, `VerificationStarted`, `VerificationCompleted`, `ToolFailed`, `EvidenceCollected`
- Helpers: `getRetryCount`, `getPolicyDecision`, `getVerificationStatus`, `getEvidenceRefs`, `getToolFailures`

**Fase 2 — Policy, Side Effects e Security**

- `SideEffectClass` enum: `read_fs|write_fs|spawn_process|network_call|git_mutation|db_change|secret_access|infra_operation`
- `AutonomyTier` type: `L0|L1|L2|L3` — tier controla quais side effects são permitidos automaticamente
- `NodePolicyConfig` com `mutation_budget` e `autonomy_tier`
- `EnvironmentGuardrail` com `protected_paths`, `protected_branches`, `require_human_gate_on`
- Guardrails default: paths `.env`, `package.json`, `.oxe/config.json`; gate automático para `infra_operation`, `db_change`, `secret_access`
- `PolicyEngine.withGuardrail(g)` para customizar guardrails por projeto
- `side_effect_class` e `autonomy_tier` em `PolicyWhenClause` para regras direcionadas

**Fase 3 — Verify Operational**

- `VerificationManifest` formal: persistido em `.oxe/runs/{runId}/verification-manifest.json`
- `VerificationProfile`: `quick|standard|critical` — controla quais `FailureClass` geram riscos residuais
- `FailureClass` taxonomy: `deterministic|flaky|timeout|env_setup|policy_failure|evidence_missing`
- `classifyFailure(result)` — classifica automaticamente cada `CheckResult`
- `buildManifest(runId, results, options)` — compila manifest por work item, onda ou run
- `ResidualRiskLedger` persistido em `.oxe/runs/{runId}/residual-risks.json`
- `buildRiskLedger(runId, manifest)` — gera ledger de riscos residuais a partir do manifest

**Fase 4 — Delivery Native**

- `MergeGateEvaluator.evaluate(runResult, manifest, ledger)` — avalia se run está pronto para merge
- Bloqueios: tarefas failed/blocked, verificação falha, riscos `high`/`critical`
- `PromotionPipeline.promote(runResult, manifest, ledger, opts)` — cria PR draft via `gh`, persiste `RunPRLink`
- `PromotionPipeline.buildPRBody(...)` — corpo do PR com resumo, verificação e riscos residuais
- `RunPRLink` persistido em `.oxe/runs/{runId}/pr-link.json`

**Fase 5 — Context Engineering Avançado**

- `ContextPackStore`: `savePack`, `loadPack`, `markStale`, `isStale`, `listPackMeta` — packs persistidos em `.oxe/runs/{runId}/context-pack-{workItemId}.json`
- `ContextPackMeta` com `estimated_tokens`, `stale`, `stale_reason`
- `diffPacks(before, after)` — detecta added/removed/score_changed entre versões de pack
- Índice global por run em `context-packs.index.json`

**Fase 6 — Decision Engine / Seniority**

- `DecisionEngine.evaluate(input)` — avalia policy, gate, retry budget, risk, lesson match e retorna `DecisionRecord` com `type`, `seniority`, `confidence` e `rationale`
- Tipos de decisão: `proceed|retry|escalate_gate|skip|abort|promote_lesson`
- `SeniorityLevel`: `junior|standard|senior|expert` derivado da confidence
- `appendDecision`, `loadDecisionLog`, `queryDecisions` — log persistido em `.oxe/runs/{runId}/decisions.json`

**Fase 7 — Multi-Agent Robusto**

- `AgentRegistry` com heartbeat tracking por agente
- `registry.beat(id, currentTask)` — atualiza last_seen e status
- `registry.isAlive(id)` — detecta timeout configurável por instância
- `registry.timedOut()` / `registry.liveAgents()` — filtragem por liveness
- `registry.failover(fallbackAgentId)` — reassigna tasks de agentes expirados para fallback
- `registry.setStatus(id, status)` — transições manuais de estado

**Fase 8 — ABI Estável de Plugins**

- `PluginManifest` com `abi_version`, `capabilities`, declared providers
- `extractManifest(plugin)` — extrai manifest de qualquer `OxePlugin`
- `validatePlugin(plugin)` — retorna `{ valid, errors, warnings }` com checagem de nome, semver, providers
- `isAbiCompatible(version)` — garante compatibilidade de major version
- `sandboxInvoke(fn, timeoutMs)` — execução com timeout e isolamento de erro para plugins

**Fase 9 — Enterprise Operations**

- `AuditTrail` — registro imutável NDJSON em `.oxe/AUDIT-TRAIL.ndjson`
- 14 tipos de ação auditáveis: `run_started`, `secret_accessed`, `infra_mutation`, `merge_approved`, etc.
- Severity automática por ação (`info|warn|critical`)
- `AuditTrail.query(filter)` — filtra por action/severity/runId/since
- `RunQuota` — `createQuota`, `consumeQuota`, `checkQuota` para limitar work_items, mutations e retries por run

### Testes

- Runtime: **266 testes** (↑ de 145 pré-robustez)
- Root: 321 testes (sem regressões)
- Total: **587 testes** passando

---

## [1.1.0] — 2026-04-18

### Mudança de superfície (simplificação estratégica de produto)

**Trilha principal reduzida a 6 comandos**

O OXE agora se comporta como um framework guiado por etapas. A superfície pública foi reorganizada em três níveis:

**Trilha principal (6 comandos):**
- `/oxe` — entrada universal (absorve ask, next, route, help)
- `/oxe-quick` — modo nano sem cerimônia
- `/oxe-spec` — spec com flags: `--refresh`, `--full`, `--research`, `--ui`
- `/oxe-plan` — planejamento test-first
- `/oxe-execute` — implementação com flags: `--note`, `--debug`, `--deep-diagnosis`, `--checkpoint`, `--iterative`
- `/oxe-verify` — validação e fechamento com flags: `--gaps`, `--security`, `--ui`, `--pr`, `--diff`, `--skip-retro`

**Trilha avançada:** `/oxe-session` (absorve project, milestone, workstream), `/oxe-dashboard`

**Administrativa:** `/oxe-capabilities`, `/oxe-skill`, `oxe-cc azure`

### Depreciado (v1.1.0)

Os seguintes comandos foram incorporados por estágios principais e continuam funcionando com aviso de migração:

| Comando | Novo destino |
|---------|-------------|
| `/oxe-ask` | `/oxe "pergunta"` |
| `/oxe-scan` | `/oxe-spec --refresh` |
| `/oxe-research` | `/oxe-spec --research` |
| `/oxe-ui-spec` | `/oxe-spec --ui` |
| `/oxe-obs` | `/oxe-execute --note` |
| `/oxe-debug` | `/oxe-execute --debug` |
| `/oxe-forensics` | `/oxe-execute --deep-diagnosis` |
| `/oxe-checkpoint` | `/oxe-execute --checkpoint` |
| `/oxe-loop` | `/oxe-execute --iterative` |
| `/oxe-validate-gaps` | `/oxe-verify --gaps` |
| `/oxe-security` | `/oxe-verify --security` |
| `/oxe-ui-review` | `/oxe-verify --ui` |
| `/oxe-review-pr` | `/oxe-verify --pr` |
| `/oxe-retro` | `/oxe-verify` (retro automática) |
| `/oxe-project` | `/oxe-session milestone\|workstream` |
| `/oxe-compact` | `/oxe-spec --refresh` |
| `/oxe-next` | `/oxe` (sem argumento) |
| `/oxe-route` | `/oxe "intenção"` |
| `/oxe-milestone` | `/oxe-session milestone` |
| `/oxe-workstream` | `/oxe-session workstream` |

### Novos comportamentos

- **Retro automática:** `/oxe-verify` executa automaticamente retrospectiva ao fechar (`--skip-retro` para desativar)
- **Pergunta situacional inline:** `/oxe "pergunta"` substitui `/oxe-ask`
- `/oxe-session` agora suporta `milestone` e `workstream` como subcomandos

---

## [0.8.0] — 2026-04-14

### Adicionado

**Session forking + revert**
- `session fork [nome]` — bifurca a sessão ativa, copiando todos os artefatos para uma nova sessão; rastreia `forked_from` na SESSION.md
- `session revert <checkpoint-slug>` — restaura STATE.md ao snapshot de um checkpoint, sem apagar artefatos atuais

**Skill system**
- `/oxe-skill` — workflow para descobrir, invocar e gerenciar skills (unificação de personas e capabilities)
- `@<skill-id>` no chat resolve persona OU capability OU composite como ponto de entrada único
- Template `SKILL.template.md` para criação de skills de projeto em `.oxe/skills/`
- Resolução em 3 camadas: project → capabilities → global (personas do pacote)

**Sistema de permissões com wildcard**
- `permissions[]` em `.oxe/config.json` — regras glob+ação que controlam acesso a arquivos durante execute e apply
- Ações: `allow`, `deny`, `ask` — avaliação first-match wins
- Scopes: `execute`, `apply`, `all`
- Gate automático no workflow execute antes de cada onda

**Config hierárquico (system → user → project)**
- `loadOxeConfigMerged()` agora lê 3 níveis: system (`OXE_SYSTEM_CONFIG` ou path OS-default) < user (`~/.oxe/config.json`) < project (`.oxe/config.json`)
- `status --full` exibe fontes de cada nível de configuração
- Campo `sources` no retorno do SDK

**Event sourcing com replay**
- `replayEvents()` no SDK — reconstrói timeline de `OXE-EVENTS.ndjson` com deltas, filtros por run/wave/event
- `oxe-cc runtime replay [--run <id>] [--from <event-id>] [--wave <n>] [--write]` — visualização de timeline no terminal ou `REPLAY-SESSION.md` em disco
- Integração com `/oxe-forensics` — replay como ferramenta de investigação

**Plugin system com carregamento remoto**
- `plugins[]` em `config.json` aceita `{ source: "npm:<pkg>" }` e `{ source: "path:./file.cjs" }`
- `oxe-cc plugins list` — lista plugins carregados (local + externos)
- `oxe-cc plugins install npm:<pkg>` — instala plugin npm em `.oxe/plugins/_npm/`
- `resolvePluginSources()` e `installNpmPlugin()` expostos no SDK

### Tipos TypeScript
- `OxePermissionRule`, `PermissionCheckResult`, `ReplayReport`, `PluginSource` adicionados
- `security.checkFilePermission`, `security.checkPermissions`, `security.globToRegex` declarados
- `operational.replayEvents` declarado
- `plugins.resolvePluginSources`, `plugins.installNpmPlugin` declarados
- `health.loadOxeConfigMerged` retorna `sources: { system, user, project }`

---

## [0.7.0] — 2026-04-13

### Adicionado

**Provider Azure nativo (`oxe-cc azure`)**
- `azure status` — estado compacto read-only: CLI, login, subscription, inventário, pendências, alerta VPN
- `azure operations list` — histórico colorido de operações (planned/applied/pending)
- `azure find --type <serviço>` — filtro por família de serviço (servicebus, eventgrid, sql)
- `azure find --filter-rg <rg>` — filtro por resource group
- `azure sync --diff` — mostra recursos adicionados/removidos em relação ao snapshot anterior
- `azure apply --dry-run` — pré-visualiza comando `az` sem executar nem criar artefatos
- `azure auth login --tenant <id>` — suporte a Entra ID corporativo; passa `--tenant` ao `az login`
- `azure apply --vpn-confirmed` — confirma conexão VPN quando `vpn_required: true` está configurado

**SDK**
- `azure.diffInventory(previousItems, currentItems)` — compara snapshots de inventário (adicionados/removidos/unchanged)
- `azure.statusAzure(projectRoot, config?, options?)` — status compacto sem writes

**Workflows (guardrails)**
- `scan.md`: detecção Azure é informativa — não altera fluxo canônico OXE nem aciona steps Azure automaticamente
- `plan.md`: pré-check Azure só ativa quando Azure é mencionado **explicitamente** na SPEC ou `.oxe/cloud/azure/` existe
- `discuss.md`: perguntas Azure só ativam quando SPEC menciona Azure explicitamente — SQL genérico (PostgreSQL, MySQL, on-prem) não aciona o bloco

### Corrigido
- `loginAzure()` com `inherit: true` não passava mais `inherit` para `getAzureContext`, evitando crash ao tentar ler `account.id` de stdout null

### Tipos TypeScript
- `azure.searchAzureInventory` inclui parâmetro opcional `filters?: { type?, resourceGroup? }`
- `azure.diffInventory` declarado
- `azure.statusAzure` declarado

---

## [0.6.3] — 2026-04-04

### Corrigido
- `security_in_verify` agora é reconhecido como chave válida em `.oxe/config.json` (não mais rejeitado pelo doctor como "unknown key")
- `plan-agents.schema.json`: enum atualizado de `[1, 2]` para `[2, 3]`; campos `persona` e `model_hint` adicionados ao schema dos agentes

### Adicionado
- **`/oxe-retro` sugerido automaticamente** pelo `oxe-cc status` quando `phase: verify_complete` e `.oxe/LESSONS.md` ainda não existe
- **`health.parseLastRetroDate(stateText)`** — parseia campo `last_retro: YYYY-MM-DD` do STATE.md
- **`health.isStaleLessons(retroDate, maxDays)`** — detecta se LESSONS.md está desatualizado (par de `isStaleScan`)
- **`health.planAgentsWarnings(target)`** — avisa sobre schema 1 (legado) e `model_hint` inválido em `plan-agents.json`
- **`parseState()`** retorna novo campo `lastRetroDate: string | null`
- `OxeHealthReport` inclui `retroDate: Date | null`
- `config.template.json` inclui `security_in_verify: false` por padrão
- `plan-agents.template.json` inclui campo `persona` no agente-exemplo
- Melhorias de workflow: `obs.md` (tabela de classificação de impacto), `verify.md` (success_criteria camadas 5+6), `next.md` (flag de promoção QUICK→spec), `quick.md` (incorporação de OBSERVATIONS), `plan.md` (nota de replan + plan-agents sync)
- `AGENTS.md` atualizado para v0.6.x

### Tipos TypeScript
- `ParsedState` inclui `lastRetroDate: string | null`
- `OxeHealthReport` inclui `retroDate: Date | null`
- `health.*` expõe `parseLastRetroDate`, `isStaleLessons`, `planAgentsWarnings`

---

## [0.6.2] — 2026-04-04

### Adicionado
- **`/oxe-retro`** — workflow de retrospectiva de ciclo; sintetiza 3–5 lições prescritivas em `.oxe/LESSONS.md`
- `oxe/templates/LESSONS.template.md`
- Correções de consistência de schema (plan-agent.md, verify.md): referências atualizadas para schema v3

### Alterado
- README: tabela "Como cada comando fica mais inteligente" expandida com loop, security, research thinking_depth, model_hint
- Cadeia de help (`oxe.md`) atualizada para incluir `/oxe-retro` após verify

---

## [0.6.1] — 2026-04-04

### Adicionado
- **`/oxe-security`** — auditoria OWASP Top 10 filtrada pelo stack; produz `.oxe/SECURITY.md` com achados P0/P1/P2
- **`/oxe-loop`** — execução iterativa de onda com retries automáticos e diagnóstico inline
- **Model hints** em `plan-agents.json` schema v3: campo `model_hint` (`fast | balanced | powerful`) por agente
- **Thinking depth** em `/oxe-research`: classificação `surface | standard | deep` com raciocínio estendido para `deep`
- Integração automática de security no verify via `security_in_verify: true` (Camada 6)
- `oxe/templates/SECURITY.template.md`

---

## [0.6.0] — 2026-04-04

### Adicionado
- Workflow `/oxe-project` unificando `milestone`, `workstream`, `checkpoint`
- `/oxe-obs` com propagação automática para R-IDs e Tns afetados
- Auto-reflexão semântica em `/oxe-spec` (Fase 4b): detecta contradições e escopo creep antes da aprovação
- Modo de execução A/B/C em `/oxe-execute` (Completo / Por onda / Por tarefa)
- Debug inline automático em falhas de execute
- 4 profiles de execução: `balanced`, `strict`, `fast`, `legacy`
- Sistema de personas para agentes (`oxe/personas/`)
- Plugin lifecycle (`.oxe/plugins/*.cjs`)
- `scale_adaptive`: scan sugere profile pelo tamanho do projeto

---

## [0.5.0] — anterior

Versões anteriores não documentadas neste arquivo.
