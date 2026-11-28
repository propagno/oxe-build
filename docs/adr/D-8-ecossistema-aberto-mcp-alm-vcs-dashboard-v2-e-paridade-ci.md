<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-8 — Ecossistema Aberto (MCP nativo, ALM GitHub/GitLab Issues), Loops Automáticos, Dashboard v2 e Paridade CI (`v1.23.0`)

- **Status:** Aceita
- **Data:** 2026-11-27
- **Critérios:** A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16, A17, A18
- **Por:** arquitetura

## Contexto

O corte real da `v1.22.2` revelou quatro fricções operacionais recorrentes (publicação npm assíncrona / OIDC em Node 20, falso `broken` no `oxe-cc doctor` em checkout limpo de `product_package` com sessão local gitignored, flake de reuso de PID no Windows em `promote-fixtures`, e falta de gate local de paridade pré-push) ao mesmo tempo em que as bases introduzidas na `1.22.2` (`agents`, `reevaluate`, `suggested_model_hint`, `onboard`) ainda exigiam acionamento manual e restringiam a interoperabilidade a CLI puro + Jira/Azure DevOps.

## Decisão

A linha `v1.23.0` consolida quatro decisões arquiteturais alinhadas ao agnosticismo (`D-5`) e à decomposição incremental (`D-6`), mantendo **zero novas dependências npm de produção** e compatibilidade `Node >= 18.0.0`:

1. **Paridade pré-push & resiliência de release (`OB-62`..`OB-64`):** `.github/workflows/release.yml` executa `publish-npm` em Node 24 (OIDC Trusted Publishing com fallback `NPM_TOKEN`) e loop de retry/backoff no `npm view`; `oxe-cc doctor` tolera `active_session` local gitignored em `product_package` sem relaxar `oxe_project`; `bin/lib/oxe-ci-parity.cjs` (`oxe-cc doctor --ci-parity`) valida checkout limpo via `git read-tree`/`checkout-index`, paridade `engines.node` e regras `.gitignore`/symlink POSIX antes do push; `findGuaranteedDeadPid()` substitui processos efêmeros nos testes para eliminar o flake de PID no Windows.
2. **Fechamento dos loops automáticos (`OB-65`..`OB-67`):** `agents.auto_lease` (ativo por padrão, opt-out explícito) gerencia leases automaticamente em `quick`, `runtime commit-task` e `runtime execute`; `reevaluateAgainstBase` integra-se ao preflight de `runtime execute` e `runtime promote` (aviso acionável por padrão, bloqueio com `reevaluate.block_on_drift: true`); `models.auto_route: true` (opt-in) consome `suggested_model_hint` respeitando precedência estrita `override > model_hint > suggested_model_hint > default_tier`.
3. **Ecossistema aberto sem dependências externas (`OB-68`..`OB-69`):** `bin/lib/oxe-mcp-server.cjs` (`oxe-cc mcp`) expõe 11 ferramentas OXE tipadas em JSON-RPC 2.0 stdio puro (suportando framing `Content-Length` e NDJSON); `bin/lib/oxe-alm-vcs.cjs` adiciona providers ALM nativos `github-issues` (`gh`) e `gitlab-issues` (`glab`) em `oxe-alm.cjs` e `oxe-onboard.cjs` com `--dry-run` seguro e zero dependência de Jira.
4. **Visibilidade ao vivo & Strangler Fig Fatia 3 (`OB-70`..`OB-71`):** `oxe-dashboard.cjs` evolui para Dashboard v2 (navegação completa por seções, tela inicial orientada a ação imediata e endpoint `/api/state` expondo `active_agents`, `agent_messages`, `agent_collisions`, `worktree_hygiene`, `reevaluate`, `scorecard_routing` e `delivery`); a Fatia 3 da `D-6` extrai `bin/lib/operational/plan-lint-runtime.cjs` (`-1.007` linhas em `oxe-operational.cjs`) e `bin/lib/commands/status-doctor-commands.cjs` (`-1.076` linhas em `bin/oxe-cc.js`) com zero ciclos e 0 drift de SDK.
5. **Entrega autônoma ponta a ponta (`F5`–`F8`, `A12`–`A15`):** `oxe-primer.cjs` (`oxe-cc primer` + MCP `oxe_primer`), `oxe-deliver-intake.cjs`, `oxe-deliver-engine.cjs` (máquina de estados `DELIVER.json` com escolha inicial `single-ok` vs. `auto`, anti-cheat SHA-256 de testes congelados, anti-stub, regressão cumulativa e auto-cura com circuit breaker), `oxe-deliver-runner.cjs` (`deliver run` headless) e `oxe-deliver-handoff.cjs` (`FINAL_SMOKE` real + `DELIVERY.md`), unificados no workflow `/oxe-deliver`, em 4 tools MCP (`oxe_primer`, `oxe_deliver_*`) e no cartão `Entrega Pronta` do Dashboard v2.
6. **Dogfooding, Deliver Pro & SDK Facade + ESM (`F9`–`F11`, `A16`–`A18`):** `PRD.md` por sessão ativa + tabela compacta de 4 colunas (`oxe-prd.cjs`), agrupamento de avisos `[G30]` (`oxe-suite-impact.cjs`), detecção de drift `major.minor` de `scorecard-report.json` no `doctor --ci-parity`, scaffold `oxe-cc workflow new <slug>`, `probeHttpServerSmoke` em porta efêmera, ondas paralelas disjuntas (`partitionDisjointTasks`) + auto-branch/commit local `OXE-Deliver:`, e facade `createClient(projectRoot)` com entrypoint ESM nativo `lib/sdk/index.mjs` e `0 drift` em `lib/sdk/index.d.ts`.

## Consequências

- Qualquer agente/IDE compatível com MCP (Antigravity, Claude Code, Cursor, Codex, Copilot) consome `oxe-cc mcp` nativamente sem instalar SDK externo.
- Times que operam exclusivamente com GitHub ou GitLab Issues adotam o ciclo ALM completo do OXE sem credenciais Jira/Azure DevOps.
- `bin/oxe-cc.js` cai abaixo de 9.000 linhas e `bin/lib/oxe-operational.cjs` abaixo de 13.600 linhas preservando 100% da ABI pública e dos testes.

## Evidência

`node --test tests/acceptance/oxe-1230-a*.test.cjs && npm run test:sdk-types && node bin/oxe-cc.js doctor --ci-parity --json`

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
