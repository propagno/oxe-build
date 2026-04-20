<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

**Versão:** `1.4.0` · [package.json](package.json)

**Framework OXE — Orchestrated eXperience Engineering**

```bash
npx oxe-cc@latest
```

</div>

---

## O que é o OXE

> **OXE é a camada de disciplina entre você e seu agente de IA. Qualquer agente, qualquer IDE, qualquer projeto — o mesmo ciclo estruturado, com histórico persistente que melhora a cada entrega.**

OXE é o **Framework OXE — Orchestrated eXperience Engineering**: um framework de desenvolvimento assistido por IA orientado por artefatos, contexto em disco e execução verificável. Funciona identicamente em Cursor, GitHub Copilot, Claude Code, Gemini CLI, Windsurf e qualquer outro agente — o estado fica em `.oxe/` no seu projeto, não preso a nenhuma IDE.

No momento atual, o OXE opera em duas camadas complementares já prontas para publicação:

- **framework de método** — `spec -> plan -> execute -> verify`, sessões, workstreams, lessons loop e contratos de raciocínio multi-runtime
- **runtime enterprise** — `ExecutionGraph`, `canonical_state`, context packs, evidence store, verification manifest, gates, policy, promotion, recovery e auditoria operacional

Ele se apoia em três princípios:

- **Spec-driven design** — antes de escrever código, você define *o que* construir e *como saber que está pronto*. Essa especificação restringe e guia tudo o que vem depois.
- **Context engineering** — o estado do trabalho fica em arquivos pequenos dentro de `.oxe/`, não na memória do chat. O agente lê o que precisa, quando precisa — sem sobrecarregar o contexto com decisões já tomadas.
- **Lessons loop** — ao fim de cada ciclo, `/oxe-retro` extrai 3–5 lições prescritivas que o próximo spec/plan lê automaticamente. Depois de alguns ciclos, os planos ficam dramaticamente melhores porque os erros anteriores não se repetem.
- **Plan-Driven Dynamic Agents** — quando há múltiplos domínios, o plano cria agentes específicos para *aquela demanda*. Agentes não são reaproveitados entre projetos ou demandas.
- **Semântica de raciocínio multi-runtime** — discovery, planning, execution, review e status seguem contratos cognitivos explícitos. O mesmo workflow OXE deve gerar respostas exploratórias, decision-complete e auditáveis em Copilot, Cursor, Claude, Codex e demais runtimes suportados.

O resultado: **menos requisições**, **mais coerência**, e uma experiência de engenharia orquestrada que funciona do mesmo jeito em qualquer IDE.

---

## Semântica de raciocínio do OXE

O OXE agora distingue cinco famílias de raciocínio:

- `discovery` — explorar antes de perguntar; separar fatos, inferências e lacunas
- `planning` — produzir plano decision-complete, com riscos, validação e confidence gate
- `execution` — reconhecimento curto antes de mutar; menor write set viável; validação por fatia
- `review` — findings primeiro, severidade, evidência e risco residual
- `status` — leitura curta do estado, recomendação única e motivo

Essas regras vivem no núcleo canónico em `oxe/workflows/references/reasoning-*.md`, sobem para os workflows em `oxe/workflows/` e são renderizadas para cada runtime em `.github/prompts/`, `.cursor/commands/`, `commands/oxe/`, `.codex/prompts/` e skills multiagente.

---

## Momento atual do produto

O OXE já não é só um conjunto de prompts e markdowns. Hoje ele combina:

- **artefatos canónicos em `.oxe/`** para continuidade entre sessões, IDEs e agentes
- **Context Engine V2** para seleção e compressão determinística de contexto
- **runtime TypeScript compilado para CJS** em `packages/runtime/`, responsável por grafo formal, scheduler, evidence, gates, policy, promotion e recovery
- **projeção derivada para markdown**: `PLAN.md`, `VERIFY.md`, `STATE.md`, summaries e dashboards passam a refletir o estado formal sempre que o runtime está disponível
- **fallback compatível**: se o runtime não estiver compilado, os comandos seguem funcionando no modo legado, sem quebrar a UX do OXE

Em termos práticos, o estado operacional real agora passa por:

- `ACTIVE-RUN.json`
- `.oxe/runs/<run_id>.json`
- `.oxe/runs/<run_id>/verification-manifest.json`
- `.oxe/runs/<run_id>/residual-risk-ledger.json`
- `.oxe/runs/<run_id>/evidence-coverage.json`
- `.oxe/execution/GATES.json`
- `OXE-EVENTS.ndjson`

Contrato estável desta release:

- `execute` e `verify` são `runtime-first` quando `oxe-cc runtime` está disponível
- `status`, `doctor`, dashboard e CLI de runtime leem o mesmo estado canónico
- `multi-agent` é GA apenas com isolamento real (`git_worktree`); `inplace` não é backend válido para coordenação paralela
- `pr_draft` é o alvo remoto estável de promotion nesta publicação

---

## Modos de uso

Escolha a complexidade certa para sua tarefa. Você sempre começa simples e adiciona estrutura quando precisar.

### Nano — 1 comando
Para tarefas pequenas e pontuais, sem overhead:
```
/oxe-quick → objetivo → passos → verify
```

### Standard — ciclo completo
Para features, refatorações ou qualquer trabalho com múltiplos arquivos:
```
/oxe → /oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify
```

> scan, research, debug, retro e validações especializadas são acionados automaticamente
> pelos estágios corretos ou por flags explícitas (ex.: `--research`, `--debug`, `--security`).

### Full — orquestração avançada
Para projetos longos, multi-domínio, múltiplos agentes ou times:
```
/oxe-session new <nome>   ← isola o ciclo numa sessão
/oxe-plan --agents        ← blueprint multi-agente
/oxe-execute              ← com runtime tracking, checkpoints e eventos
/oxe-dashboard            ← visão web opcional para revisão de equipe
```

> O README apresenta o modo Standard na maior parte da documentação. O modo Full está descrito em detalhes em cada seção específica.

---

## Trilha principal

```
/oxe              → onde estou / o que faço / help / perguntas situacionais
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-spec         → nova feature: perguntas → requisitos → roteiro
                    (absorve scan, research e ui-spec via flags)
/oxe-plan         → tarefas por onda (--agents para multi-agente)
/oxe-execute      → implementar (A: completo | B: por onda | C: por tarefa)
                    (absorve obs, debug, forensics, checkpoint, loop via flags)
/oxe-verify       → validar e fechar o ciclo (retro automática)
                    (absorve gaps, security, ui-review, review-pr via flags)
```

## Trilha avançada

```
/oxe-session      → criar, alternar, retomar, fechar ou migrar sessões OXE
/oxe-dashboard    → visualizar runtime, ondas, checkpoints e estado operacional
```

## Comandos administrativos

```
/oxe-capabilities → catálogo nativo de capabilities
/oxe-skill        → skills OXE via @<id>
oxe-cc azure      → autenticar, sincronizar inventário e operar Azure com checkpoint formal
```

Tudo o mais é ativado automaticamente por contexto, por config, ou existe como flag dos estágios principais.

---

## Sessões OXE

Sessões organizam um ciclo completo em `.oxe/sessions/sNNN-slug/` sem misturar artefatos de entregas diferentes na raiz. `spec`, `plan`, `execute`, `verify`, `checkpoint`, `research` e afins respeitam `active_session` em `.oxe/STATE.md`. `oxe-cc status` e `oxe-cc doctor` também devem refletir a sessão ativa, a autoavaliação do plano e a saúde lógica do fluxo.

```text
.oxe/
├── STATE.md
├── SESSIONS.md
├── global/
│   ├── LESSONS.md
│   └── MILESTONES.md
├── codebase/
└── sessions/
    └── s001-exemplo/
        ├── SESSION.md
        ├── spec/
        ├── plan/
        ├── execution/
        ├── verification/
        ├── checkpoints/
        ├── research/
        └── workstreams/
```

| Subcomando | O que faz |
|------------|-----------|
| `/oxe-session new <nome>` | Cria a sessão e define `active_session` |
| `/oxe-session list` | Lista sessões em `.oxe/SESSIONS.md` |
| `/oxe-session switch <id>` | Alterna a sessão ativa |
| `/oxe-session resume <id>` | Alias de `switch` |
| `/oxe-session status` | Mostra os metadados da sessão ativa |
| `/oxe-session close` | Arquiva a sessão ativa |
| `/oxe-session migrate <nome>` | Cria sessão nova e move artefatos session-scoped da raiz |

Exemplo de ciclo:

```text
/oxe-session new auth-redesign
/oxe-spec
/oxe-plan
/oxe-execute
/oxe-verify
/oxe-session close
```

Com sessão ativa:

- `spec/` contém `SPEC.md`, `ROADMAP.md`, `DISCUSS.md`, `UI-SPEC.md`
- `plan/` contém `PLAN.md`, `QUICK.md`, `plan-agents.json`, `quick-agents.json`
- `execution/` contém o `STATE.md` operacional da trilha, `EXECUTION-RUNTIME.md`, `CHECKPOINTS.md`, `ACTIVE-RUN.json`, `OXE-EVENTS.ndjson`, `runs/`, `OBSERVATIONS.md`, `DEBUG.md`, `FORENSICS.md`
- `research/` também pode conter `INVESTIGATIONS.md` e `investigations/` para evidência estruturada
- `verification/` contém `VERIFY.md`, `VALIDATION-GAPS.md`, `SECURITY.md`, `UI-REVIEW.md`
- `LESSONS.md`, `MILESTONES.md`, `codebase/`, `SESSIONS.md`, `CAPABILITIES.md`, `capabilities/` e o `STATE.md` global permanecem fora da sessão

---

## A cadeia

```
/oxe → /oxe-spec → /oxe-plan ──────────→ /oxe-execute → /oxe-verify
                       ↓                                      ↓
                  /oxe-quick (trabalho pequeno)     .oxe/global/LESSONS.md
                                                               ↓
                                                    (alimenta o próximo ciclo)
```

**Comportamentos absorvidos por cada estágio:**

| Estágio | Absorve (via flags ou automático) |
|---------|-----------------------------------|
| `/oxe` | ask (perguntas situacionais inline) |
| `/oxe-spec` | scan (`--refresh`/`--full`), research (`--research`), ui-spec (`--ui`) |
| `/oxe-execute` | obs (`--note`), debug (`--debug`), forensics (`--deep-diagnosis`), checkpoint (`--checkpoint`), loop (`--iterative`) |
| `/oxe-verify` | gaps (`--gaps`), security (`--security`), ui-review (`--ui`), review-pr (`--pr`), retro (automática) |

Cada passo lê o anterior como contexto e escreve seu artefato no escopo correto: raiz `.oxe/` em modo legado, ou `.oxe/sessions/sNNN-slug/` quando `active_session` está definido. Nenhum passo depende de você re-explicar o que já foi decidido.

---

## Como cada comando funciona

| Comando | O que entrega |
|---------|--------------|
| `/oxe` | Sem input → próximo passo. Com pergunta → situação atual (artefatos reais). Com "help" → trilha principal. |
| `/oxe-spec` | **5 fases**: perguntas → pesquisa → requisitos R-ID → roteiro → aprovação. `--refresh` / `--full` fazem scan antes. `--research` ativa spike explícito. `--ui` gera UI-SPEC ao final. **Auto-reflexão semântica** automática antes da aprovação. |
| `/oxe-plan` | **Test-first:** `Verificar` vem antes de `Implementar` em cada tarefa. `PLAN.md` com `## Autoavaliação do Plano` (rubrica fixa + confiança determinística). Usa investigações e capabilities como evidência. |
| `/oxe-execute` | Execução A/B/C. Valida autoavaliação antes de implementar. `--note` registra observação. `--debug` aciona diagnóstico inline. `--deep-diagnosis` escalona para forensics. `--checkpoint "<nome>"` cria snapshot. `--iterative` ativa loop de retry. Usa `EXECUTION-RUNTIME.md`, `ACTIVE-RUN.json`, `OXE-EVENTS.ndjson`. |
| `/oxe-verify` | Até 6 camadas: audit + critérios + decisões + coerência operacional + calibração + UAT. `--gaps` ativa Camada 5 (cobertura). `--security` ativa Camada 6 (OWASP). `--ui` inclui UI-REVIEW. `--pr` / `--diff` incluem revisão de PR. Retro automática ao fechar (`--skip-retro` para desativar). |
| `/oxe-quick` | Objetivo → passos → agentes opcionais (PDDA lean) → verify. Para correções pontuais e features pequenas. |
| `/oxe-session` | Cria, alterna, retoma, fecha e migra sessões OXE. Subcomandos: `new`, `list`, `switch`, `resume`, `status`, `close`, `migrate`, `milestone`, `workstream`. |
| `/oxe-dashboard` | Consolida `STATE`, `PLAN`, `ACTIVE-RUN`, trace log, runtime, checkpoints e verify numa visão visual de ciclo, ondas, handoffs e aprovação. |
| `/oxe-capabilities` | Gera e mantém o catálogo nativo de capabilities em `.oxe/CAPABILITIES.md` e `.oxe/capabilities/`, com política, side effects e evidência esperada. |
| `/oxe-skill` | Descobrir, invocar e gerenciar skills OXE via `@<skill-id>`. Subcomandos: `list`, `explain <id>`, `new <id>`. |
| `oxe-cc azure` | Provider Azure nativo via Azure CLI: autenticação corporativa com MFA, inventário via Resource Graph e operações guiadas para Service Bus, Event Grid e Azure SQL. |

---

## Quando usar cada modo do execute

```
A) Completo   → todas as ondas numa só execução  (ideal: Claude, Copilot, Gemini)
B) Por onda   → onda 1, você verifica, chama de novo  (1 rodada por onda)
C) Por tarefa → máximo controle  (1 rodada por tarefa)
```

Se uma tarefa falha: diagnóstico inline automático (2-3 hipóteses → fix → retry). O Modo B inclui loop iterativo com escalada automática para diagnóstico profundo quando necessário.

---

## Comportamentos especializados (via flags)

Estes comportamentos continuam existindo, mas agora são ativados como flags dos estágios principais ou automaticamente por contexto. Você não precisa decorar comandos separados.

| Comportamento | Como ativar |
|---------------|-------------|
| Scan / refresh do codebase | `/oxe-spec --refresh` (incremental) ou `--full` (completo) |
| Research / spike / engenharia reversa | `/oxe-spec --research` |
| Contrato UI/UX | `/oxe-spec --ui` |
| Registrar observação durante execução | `/oxe-execute --note "texto"` |
| Diagnóstico técnico inline | `/oxe-execute --debug` |
| Diagnóstico pós-falha persistente | `/oxe-execute --deep-diagnosis` |
| Snapshot nomeado de sessão | `/oxe-execute --checkpoint "<nome>"` |
| Loop de retry até verify passar | `/oxe-execute --iterative` |
| Auditoria de cobertura pós-verify | `/oxe-verify --gaps` |
| Auditoria OWASP P0/P1/P2 | `/oxe-verify --security` |
| Auditoria de implementação UI | `/oxe-verify --ui` |
| Revisão de PR ou diff de branches | `/oxe-verify --pr` ou `--diff branchA...branchB` |
| Retrospectiva (lições do ciclo) | automática ao fechar `/oxe-verify` (desativar: `--skip-retro`) |

**Compatibilidade:** os comandos legados (`/oxe-debug`, `/oxe-forensics`, `/oxe-research`, `/oxe-security`, `/oxe-validate-gaps`, `/oxe-ui-spec`, `/oxe-ui-review`, `/oxe-review-pr`, `/oxe-checkpoint`, `/oxe-loop`, `/oxe-obs`, `/oxe-ask`, `/oxe-scan`, `/oxe-retro`, `/oxe-project`) continuam funcionando desde v1.1.0 e exibem um aviso sugerindo o novo destino.

---

## Azure no OXE

O OXE agora tem um provider Azure nativo, local-first, orientado a Azure CLI no Windows. Ele não guarda segredos no repositório: usa a sessão oficial da Azure CLI, materializa contexto em `.oxe/cloud/azure/` e integra esse contexto com `ask`, `spec`, `plan`, `execute`, `verify`, `status`, `doctor`, runtime e dashboard.

Artefatos principais:

- `.oxe/cloud/azure/profile.json`
- `.oxe/cloud/azure/auth-status.json`
- `.oxe/cloud/azure/inventory.json`
- `.oxe/cloud/azure/INVENTORY.md`
- `.oxe/cloud/azure/SERVICEBUS.md`
- `.oxe/cloud/azure/EVENTGRID.md`
- `.oxe/cloud/azure/SQL.md`
- `.oxe/cloud/azure/operations/`

Comandos principais:

```bash
# Autenticação (Entra ID corporativo: use --tenant)
npx oxe-cc azure auth login [--tenant <entra-tenant-id>]
npx oxe-cc azure auth set-subscription --subscription "<dev-sub-id>"
npx oxe-cc azure auth whoami

# Diagnóstico e estado compacto
npx oxe-cc azure doctor
npx oxe-cc azure status

# Inventário
npx oxe-cc azure sync [--diff]
npx oxe-cc azure find servicebus [--type servicebus] [--filter-rg rg-app]

# Histórico de operações
npx oxe-cc azure operations list

# Service Bus, Event Grid e Azure SQL
npx oxe-cc azure servicebus plan --kind namespace --name sb-core --resource-group rg-app --location brazilsouth
npx oxe-cc azure servicebus apply --kind namespace --name sb-core --resource-group rg-app --location brazilsouth --approve
npx oxe-cc azure servicebus apply --kind namespace --name sb-preview --resource-group rg-app --dry-run
```

Princípios:

- opt-in: ativado apenas quando a SPEC ou o codebase menciona Azure explicitamente
- discovery via Azure Resource Graph, não heurística por serviço
- mutação só com checkpoint formal
- `--dry-run` em qualquer apply: pré-visualiza o comando `az` sem executar
- `--vpn-confirmed` para projetos com `vpn_required: true` na config
- evidência operacional persistida e redacted em `.oxe/cloud/azure/operations/`

---

## Conceitos-chave

### Context engineering — estado em disco, não no chat

```
.oxe/
├── STATE.md              ← índice global: fase resumida, sessão ativa, próximo passo
├── SESSIONS.md           ← índice de sessões
├── CAPABILITIES.md       ← catálogo nativo de capabilities instaladas
├── INVESTIGATIONS.md     ← índice global de investigações estruturadas
├── EXECUTION-RUNTIME.md  ← runtime operacional legado / fallback global
├── ACTIVE-RUN.json       ← cursor e estado durável do run atual
├── OXE-EVENTS.ndjson     ← tracing append-only local-first
├── cloud/azure/          ← profile, auth-status, inventory e operações Azure
├── CHECKPOINTS.md        ← índice de aprovações e gates
├── global/
│   ├── LESSONS.md        ← lições prescritivas cumulativas
│   └── MILESTONES.md     ← marcos globais de entrega
├── capabilities/
├── investigations/
├── dashboard/
├── codebase/             ← mapa do repo (stack, estrutura, testes, …)
└── sessions/
    └── sNNN-slug/
        ├── spec/         ← SPEC.md, ROADMAP.md, DISCUSS.md, UI-SPEC.md
        ├── plan/         ← PLAN.md, QUICK.md, blueprints de agentes
        ├── execution/    ← STATE.md local, OBSERVATIONS.md, DEBUG.md, FORENSICS.md
        ├── verification/ ← VERIFY.md, VALIDATION-GAPS.md, SECURITY.md, UI-REVIEW.md
        ├── checkpoints/
        ├── research/
        └── workstreams/
```

### `/oxe-spec` — spec em 5 fases com discovery adaptativo e auto-reflexão semântica

1. **Perguntas** — blocos de 3-5 por rodada, máximo 3 rodadas
2. **Pesquisa** — proposta inline na Fase 2 (sem sair do spec), com investigações estruturadas quando houver incerteza relevante
3. **Requisitos** — tabela R-ID com v1/v2/fora e critérios A*
4. **Roteiro** — fases de entrega → `.oxe/ROADMAP.md`
5. **Auto-reflexão** *(automática, sem requisição extra)* — detecta contradições, critérios vagos, escopo creep, conflitos com stack e lacunas de evidência. Corrige antes de apresentar ao usuário.
6. **Aprovação** → instrui `/oxe-plan` ou `/oxe-plan --agents`

A spec lê `.oxe/global/LESSONS.md` antes de iniciar — lições do ciclo anterior informam as perguntas e os critérios.

### `/oxe-plan` — test-first com complexidade explícita

Cada tarefa usa a ordem **Verificar → Implementar** (test-first):
```
Verificar: como saberei que está pronto?   ← definido PRIMEIRO
Implementar: o mínimo para passar o Verificar
Complexidade: S | M | L | XL
```

Tarefas `XL` bloqueiam o gate sem sub-tarefas ou justificativa. `/oxe-obs` propaga automaticamente constraints para os R-IDs e Tns afetados.

#### Iteração correta do plano

Se o usuário quiser chamar `/oxe-plan` várias vezes até ficar satisfeito, o fluxo esperado é este:

- **Mesmo escopo e mesma `SPEC.md`, mas quer refinar tarefas, ondas, dependências, riscos ou validação**: usar `/oxe-plan --replan`
- **Mudou a estratégia técnica**: voltar para `/oxe-discuss` e depois `/oxe-plan --replan`
- **Mudou requisitos, critérios, prioridades ou aceite**: voltar para `/oxe-spec` e depois `/oxe-plan`

Regra prática:

- `spec` muda o **que** será entregue
- `discuss` muda o **como** ou o **porquê** da estratégia
- `plan --replan` muda **como quebrar e executar** a mesma entrega

Se já existir `PLAN.md` no escopo atual e o usuário chamar `/oxe-plan` de novo sem alterar a spec, o OXE deve tratar isso como **replan implícito**, preservando a seção **Replanejamento** e o histórico útil do plano anterior.

### Runtime operacional e checkpoints

- `PLAN.md` continua estratégico.
- `EXECUTION-RUNTIME.md` continua como superfície humana de operação, mas o estado canónico vive no runtime.
- `ACTIVE-RUN.json` formaliza o run atual: `run_id`, cursor, estado, retries, checkpoints pendentes, `compiled_graph`, `canonical_state` e contexto de provider.
- `.oxe/runs/<run_id>.json` persiste o snapshot canónico da run com grafo compilado, suite de verify, resultados, policy, delivery e recovery.
- `.oxe/runs/<run_id>/verification-manifest.json`, `residual-risk-ledger.json` e `evidence-coverage.json` são a fonte primária do verify enterprise.
- `OXE-EVENTS.ndjson` regista tracing append-only por evento, local-first.
- `CHECKPOINTS.md` continua a trilha humana; a fila operacional de aprovação fica em `.oxe/execution/GATES.json`.
- `status`, `doctor`, `dashboard`, `runtime verify`, `runtime promote` e `runtime recover` usam esses artefatos para auditar se a execução real continua coerente com o plano.

### Runtime tracking e inspeção no terminal

O caminho padrão de inspeção é CLI-first:

```bash
oxe-cc status --full    # health + coverage matrix + readiness gate no terminal
oxe-cc runtime status   # run ativo, cursor, onda atual
oxe-cc runtime verify   # verify enterprise: suite + evidence + manifest + risk ledger
oxe-cc runtime gates list
oxe-cc runtime agents --json
oxe-cc runtime promote --target pr_draft
```

O `status --full` mostra em ANSI: readiness do ciclo, autoavaliação do plano, health lógico, contexto, gates pendentes, verify enterprise, quotas, audit trail, recovery state, multi-agent e promotion state.

### Dashboard web — opt-in para revisões de equipe

- `oxe-cc dashboard` sobe uma interface web local em `localhost` para revisar o plano antes da execução — indicado para apresentações, operação de gates e revisões em equipe, não para substituir o terminal no dia a dia.
- A UI lê os artefatos OXE reais; ela não substitui `PLAN.md`, `STATE.md` ou `VERIFY.md`.
- A visão inclui ciclo principal, mapa de artefatos, active run, trace log, trilha de ondas, handoffs, checkpoints, agentes, evidências, gates, quotas, audit summary, recovery state e promotion state sem criar uma segunda fonte de verdade.
- `oxe-cc runtime <start|pause|resume|replay|status|compile|verify|project|ci|promote|recover|gates|agents>` controla explicitamente `ACTIVE-RUN.json`, `runs/`, `GATES.json`, manifests de verify, artefatos de recovery, `multi-agent-state.json` e `OXE-EVENTS.ndjson` no mesmo contrato consumido pelo dashboard.
- A aprovação visual persiste em `plan_review_status` no `STATE.md`, em `PLAN-REVIEW.md` e em `plan-review-comments.json`.

### Critérios de publicação desta release

O pacote está pronto para uma publicação robusta quando estes sinais estiverem verdes no repositório da release:

- `npm test`
- `npm run scan:assets`
- `npm run build:vscode-ext`
- `node bin/oxe-cc.js doctor`
- `node bin/oxe-cc.js status --full`

Não há outro bloqueador funcional do plano runtime core para esta publicação. O que sobra depois dela é evolução de ergonomia e expansão de targets, não correção estrutural do contrato atual.

### `/oxe-retro` — loop de aprendizado

```
/oxe-verify completo
     ↓
/oxe-retro → 3–5 lições prescritivas → .oxe/global/LESSONS.md
                                              ↓
                              /oxe-spec (próximo ciclo lê LESSONS)
                              /oxe-plan (próximo ciclo lê LESSONS)
```

Lições não são diário — são instruções para o próximo ciclo. Exemplo:
> "Tarefas com integração de terceiros: `Complexidade: L` mínimo + `Verificar` com mock fallback"

### Plan-Driven Dynamic Agents — agentes por demanda

Com `/oxe-plan --agents` (ou sugerido quando 3+ domínios detectados):
- `runId` único por demanda — nunca reutilizado
- `role` específico ao domínio desta entrega
- `model_hint` por agente: `"fast"` / `"balanced"` / `"powerful"`
- Execute exibe o hint ao iniciar cada agente para o usuário configurar o modelo

---

## Instalação

**Requisito:** Node.js 18+

```bash
npx oxe-cc@latest
```

**Confirmar que funcionou:**

| IDE | Comando |
|-----|---------|
| Cursor | `/oxe` |
| Copilot (VS Code) | `/oxe` (requer `"chat.promptFiles": true`) |
| Claude Code | `/oxe` ou `oxe` |
| Gemini CLI | `/oxe` após `/commands reload` |
| Codex | `/prompts:oxe` |

<details>
<summary><strong>Flags de instalação</strong></summary>

| Flag | Efeito |
|------|--------|
| `--cursor` / `--copilot` | Só uma das stacks da IDE |
| `--copilot-cli` | Skills globais do Copilot CLI em `~/.copilot/skills/` |
| `--all-agents` | Cursor + Copilot + Claude + OpenCode + Gemini + Codex + Windsurf + Antigravity |
| `--global` | Layout clássico: `oxe/` na raiz + `.oxe/` |
| `--local` | Layout mínimo: só `.oxe/` (padrão) |
| `--force` / `-f` | Sobrescreve arquivos existentes (use para atualizar) |
| `--dry-run` | Lista ações sem escrever |
| `--oxe-only` | Só workflows em `.oxe/`, sem integrações IDE |
| `--no-global-cli` / `-l` | Não instala `oxe-cc` globalmente (útil em CI) |
| `OXE_NO_PROMPT=1` | Modo não-interativo (CI) |

</details>

GitHub Copilot no VS Code é **workspace-first**: o OXE instala prompt files em `.github/prompts/*.prompt.md` e mescla instruções em `.github/copilot-instructions.md`. `~/.copilot/` fica reservado ao legado detectável e ao runtime do Copilot CLI.

<details>
<summary><strong>Atualizar e desinstalar</strong></summary>

```bash
npx oxe-cc@latest --force   # atualizar workflows
npx oxe-cc update --check   # verificar versão sem atualizar
npx oxe-cc uninstall --ide-only  # remove integrações (mantém .oxe/)
```

</details>

<details>
<summary><strong>Desenvolvimento (contribuir)</strong></summary>

```bash
git clone https://github.com/propagno/oxe-build.git
cd oxe-build
npm test          # suíte completa: root + runtime TypeScript
npm run scan:assets
node bin/oxe-cc.js --help
```

</details>

---

## CLI (`oxe-cc`)

| Comando | O que faz |
|---------|-----------|
| `oxe-cc` / `oxe-cc install` | Instala workflows e integrações |
| `oxe-cc doctor` | Diagnóstico completo: Node, workflows, config, bootstrap `.oxe/`, sessão ativa, autoavaliação do plano, saúde lógica (`healthy` \| `warning` \| `broken`), drift semântico multi-runtime e workflows sem contrato no registry |
| `oxe-cc status` | Próximo passo sugerido + saúde lógica do fluxo |
| `oxe-cc status --full` | Coverage matrix + readiness gate + active run no terminal (ANSI) |
| `oxe-cc status --json` | Mesmo, em JSON (schema v5), com `healthStatus`, `activeSession`, `planSelfEvaluation`, `contextPacks`, `contextQuality`, `semanticsDrift`, `verificationSummary`, `residualRiskSummary`, `evidenceCoverage`, `pendingGates`, `policyDecisionSummary`, `quotaSummary`, `auditSummary`, `promotionSummary`, `runtimeMode`, `fallbackMode`, `gateQueue`, `policyCoverage`, `promotionReadiness`, `recoveryState`, `multiAgent` e `providerCatalog` |
| `oxe-cc context build [--workflow <slug>] [--tier <minimal\|standard\|full>]` | Gera context pack(s) em `.oxe/context/packs/` — seleção determinística de artefatos por contrato de workflow |
| `oxe-cc context inspect [--workflow <slug>]` | Inspeciona um context pack existente ou resolve sob demanda (sem escrita); útil para diagnóstico antes de iniciar um passo |
| `oxe-cc update` | Atualiza workflows para a versão mais recente |
| `oxe-cc init-oxe` | Bootstrap do `.oxe/` (STATE, config, codebase/, context/, install/) |
| `oxe-cc dashboard` | Interface web local para revisão, comentários e aprovação do plano (inclui aba Context com quality score e drift semântico) |
| `oxe-cc runtime <status\|start\|pause\|resume\|replay\|compile\|verify\|project\|ci\|promote\|recover\|gates\|agents>` | Controla o runtime enterprise: run ativo, grafo compilado, verify executável, gates, promoção remota, recovery, multi-agent e tracing operacional |
| `oxe-cc runtime replay [--run <id>] [--from <event-id>] [--wave <n>] [--write] [--json]` | Timeline operacional estruturada; `--write` gera `REPLAY-SESSION.md` com divergências e deltas |
| `oxe-cc runtime verify` | Executa `compileVerification + executeSuite + EvidenceStore + manifest + residual risk + projections` para a run ativa |
| `oxe-cc runtime gates <list\|show\|resolve>` | Lista, inspeciona e resolve gates operacionais persistidos; `list` aceita `--run`, `--status`, `--scope`, `--task` e `--json` |
| `oxe-cc runtime agents status [--run <id>] [--json]` | Inspeciona ownership, handoffs, heartbeats, timeouts e failover multi-agent |
| `oxe-cc runtime promote --target pr_draft` | Promoção remota explícita, separada de `ship`, governada por verify, gates, risk e coverage; `pr_draft` é o alvo estável desta release |
| `oxe-cc runtime recover [--run <id>] [--json]` | Reidrata journal, gates, policy decisions, evidence refs, verification artifacts e estado canónico da run |
| `oxe-cc capabilities <list\|install\|remove\|update>` | Mantém o catálogo nativo de capabilities em `.oxe/` |
| `oxe-cc plugins <list\|install\|remove>` | Gerencia plugins de lifecycle; `install npm:<pkg>` instala em `.oxe/plugins/_npm/` |
| `oxe-cc uninstall` | Remove integrações OXE do HOME e do repo |
| `oxe-cc uninstall --global-cli` | Também remove o pacote npm global do PATH |

---

## Configuração

Arquivo `.oxe/config.json`. Principais opções:

| Chave | Padrão | Descrição |
|-------|--------|-----------|
| `profile` | `"balanced"` | `strict` / `balanced` / `fast` / `legacy` |
| `verification_depth` | `"standard"` | `"thorough"` ativa gaps automático no verify (Camada 5) |
| `plan_confidence_threshold` | `70` | Limiar mínimo para `execute` aceitar um `PLAN.md` |
| `security_in_verify` | `false` | `true` ativa OWASP automático no verify (Camada 6) |
| `discuss_before_plan` | `false` | Exige aprovação de decisões antes do plano |
| `scale_adaptive` | `true` | Scan sugere o profile pelo tamanho do projeto |
| `scan_max_age_days` | `0` | Doctor avisa quando o scan estiver velho |
| `lessons_max_age_days` | `0` | Doctor avisa quando a última retro estiver velho |
| `plugins` | `[]` | Hooks de lifecycle em `.oxe/plugins/*.cjs`; aceita `{ source: "npm:<pkg>" }` e `{ source: "path:./file.cjs" }` |
| `permissions` | `[]` | Regras glob+ação para gate de arquivos em execute/apply — `{ pattern, action: allow\|deny\|ask, scope?: execute\|apply\|all }` |
| `runtime.quotas.max_work_items_per_run` | `Infinity` | Limite enterprise para work items por run |
| `runtime.quotas.max_mutations_per_run` | `Infinity` | Limite enterprise para mutações por run |
| `runtime.quotas.max_retries_per_run` | `Infinity` | Limite enterprise para retries por run |

---

## SDK

```js
const oxe = require('oxe-cc');

const plan  = oxe.parsePlan(fs.readFileSync('.oxe/PLAN.md', 'utf8')); // ou .oxe/sessions/<id>/plan/PLAN.md
const spec  = oxe.parseSpec(fs.readFileSync('.oxe/SPEC.md', 'utf8')); // ou .oxe/sessions/<id>/spec/SPEC.md
const state = oxe.parseState(fs.readFileSync('.oxe/STATE.md', 'utf8'));

const fidelity = oxe.validateDecisionFidelity(discussMd, planMd);
const result   = oxe.runDoctorChecks({ projectRoot: process.cwd() });
const expanded = oxe.health.expandExecutionProfile('strict');

async function verifyActiveRun() {
  return oxe.verifyRun?.({
    projectRoot: process.cwd(),
    runId: 'oxe-run-123',
    workItemId: 'T1',
    cwd: process.cwd(),
  });
}
```

Além dos parsers e health helpers, o SDK agora reexporta bridges do runtime enterprise para:

- `verifyRun(...)`
- `operational.buildRuntimePluginRegistry(...)`
- `operational.readRuntimeGates(...)`
- `operational.resolveRuntimeGate(...)`
- `operational.runRuntimeVerify(...)`
- `operational.runRuntimePromotion(...)`
- `operational.recoverRuntimeState(...)`

TypeScript: [`lib/sdk/index.d.ts`](lib/sdk/index.d.ts) · Docs: [`lib/sdk/README.md`](lib/sdk/README.md)

---

## Resolução de problemas

| Situação | O que tentar |
|----------|-------------|
| Comandos não aparecem no Cursor | Confirme `~/.cursor/commands/`; reinicie o Cursor |
| `/oxe-*` não aparecem no Copilot | Ative `"chat.promptFiles": true`; confirme `.github/prompts/` e `.github/copilot-instructions.md`; se existir legado em `~/.copilot/`, rode `npx oxe-cc uninstall --copilot-legacy-clean` |
| Copilot responde fora do workflow OXE | Rode `npx oxe-cc doctor`; confirme que o prompt veio de `.github/prompts/` e não do legado em `~/.copilot/`; se houver blocos mistos de outros frameworks no global, limpe o legado |
| Um runtime responde sem a nova disciplina de raciocínio | Verifique drift entre `oxe/workflows/`, `.github/prompts/`, `commands/oxe/` e os prompts instalados; rode `npm run sync:runtime-metadata` e `npm run sync:cursor` no repo do pacote |
| Arquivos não atualizam | Reinstale com `--force` |
| `ETARGET` / versão não encontrada | `npm cache clean --force` |
| Erro no WSL sobre Node | Use Node instalado dentro do WSL |

`oxe-cc --help` · `oxe-cc doctor` · `OXE_NO_BANNER=1` desativa o banner

---

## Licença

[MIT](LICENSE)
