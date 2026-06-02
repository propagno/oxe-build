<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="OXE" width="920" />
</p>

[![npm](https://img.shields.io/npm/v/oxe-cc.svg?style=flat-square)](https://www.npmjs.com/package/oxe-cc)
[![license](https://img.shields.io/npm/l/oxe-cc.svg?style=flat-square)](LICENSE)

**Versão:** `1.14.0` · [package.json](package.json)

**Framework OXE — Orchestrated eXperience Engineering**

```bash
npx oxe-cc@latest
```

</div>

---

## O que é o OXE

> **OXE é a camada de disciplina entre você e seu agente de IA. Qualquer agente, qualquer IDE, qualquer projeto — o mesmo ciclo estruturado, com memória persistente que melhora a cada entrega.**

OXE é o **Framework OXE — Orchestrated eXperience Engineering**: um sistema de desenvolvimento assistido por IA orientado por artefatos, contexto em disco e execução verificável. Funciona em Cursor, GitHub Copilot, Claude Code, Gemini CLI, Windsurf e qualquer outro agente — o estado fica em `.oxe/` no seu projeto, não preso a nenhuma IDE.

A partir da v1.12.0, o OXE opera em três camadas complementares:

- **modo autônomo** — `/oxe <objetivo>` → Conductor Agent classifica, recupera memória, seleciona personas e decide automaticamente Agent Mode ou Swarm Mode
- **framework de método** — `spec → plan → execute → verify`, sessões, workstreams, lessons loop e contratos de raciocínio multi-runtime
- **runtime enterprise** — `ExecutionGraph`, evidence store, verification manifest, gates, policy, promotion, recovery e auditoria operacional

Seus princípios:

- **Spec-driven design** — antes de escrever código, você define *o que* construir e *como saber que está pronto*.
- **Context engineering** — o estado do trabalho fica em arquivos pequenos em `.oxe/`, não na memória do chat. O agente lê o que precisa, quando precisa.
- **Memory Kernel** — memória cross-session em `.oxe/memory/REPO-MEMORY.md` injetada automaticamente antes de cada run. Decisões, pitfalls e padrões não se perdem entre sessões.
- **Learning Kernel** — ao fim de cada ciclo, padrões são destilados, lições atualizadas com dedup e skills candidatas enfileiradas para promoção. Os próximos planos ficam melhores porque os erros anteriores não se repetem.
- **Plan-Driven Dynamic Agents** — quando há múltiplos domínios, o Conductor cria agentes específicos para *aquela demanda* com ownership de arquivo e coordenação por ondas.
- **Semântica de raciocínio multi-runtime** — discovery, planning, execution, review e status seguem contratos cognitivos explícitos em qualquer IDE.

O resultado: **menos requisições**, **mais coerência**, e uma experiência de engenharia orquestrada que aprende com cada ciclo.

---

## Modo autônomo — `/oxe <objetivo>`

A forma mais direta de usar o OXE a partir da v1.12.0:

```
/oxe cria um módulo de importação de arquivos com histórico e validação
```

O **Conductor Agent** (`oxe/workflows/conduct.md`) faz automaticamente:

1. **Classifica** a complexidade: simples | médio | complexo
2. **Recupera memória** das 5 camadas (runtime_state → session → project → lessons → observations)
3. **Seleciona personas** aplicáveis ao objetivo (executor, architect, ui-specialist, db-specialist…)
4. **Decide o modo** e executa:

```
intent_score = simples ou médio
  → Agent Mode: Conductor age sozinho com a persona correta
    artefatos: .oxe/agent/AGENT-SESSION.json

intent_score = complexo (3+ domínios, 8+ arquivos, feature end-to-end)
  → Swarm Mode: Scout → Coordinator → Builders → Reviewer → Verifier
    artefatos: .oxe/swarm/SWARM-RUN.json, BOARD.md, FILE-OWNERSHIP.json
```

### Agent Mode

Para objetivos de 1–2 domínios. O Conductor age como implementador com a persona mais adequada:

```
/oxe ajusta o texto do botão de exportar para "Exportar CSV"
→ persona: executor
→ discovery mínimo → implementa → verifica → grava AGENT-SESSION.json
→ OXE-EVENTS.ndjson: RunStarted + WorkItemCompleted + RunCompleted
```

Artefatos em `.oxe/agent/`:
- `AGENT-SESSION.json` — intent, skills carregadas, work_items, reconciliação
- `MEMORY-INJECTIONS.md` — contexto de memória injetado (auditável)
- `SKILLS-LOADED.json` — personas ativas no run
- `RECONCILIATION.md` — resultado final: objective_satisfied, arquivos alterados

### Swarm Mode

Para objetivos complexos com múltiplos domínios. Uma equipe de agentes especializados opera em pipeline:

```
/oxe criar módulo de importação com histórico, validação e tela de acompanhamento
→ Swarm: Scout + builder-backend + builder-frontend + builder-storage + Reviewer + Verifier
→ FILE-OWNERSHIP.json: sem conflito, 3 builders em paralelo na wave 1
→ reviews/T001..T005-REVIEW.md por task
→ FINAL-INTEGRATION.md com evidências
→ LESSONS.md atualizado automaticamente
```

Artefatos em `.oxe/swarm/`:
- `SWARM-RUN.json` — estado completo do run multi-agente
- `TASK-GRAPH.json` — tarefas, dependências e waves
- `FILE-OWNERSHIP.json` — qual agente toca qual arquivo (sem conflitos)
- `BOARD.md` / `BOARD.json` — visão em tempo real: status por task, bloqueios, gates
- `scout/` — `CODEBASE-MAP.md`, `PATTERNS.md`, `RISK-MAP.md`, `FILE-CANDIDATES.json`
- `reviews/` — um arquivo por task, produzido pelo Reviewer
- `FINAL-INTEGRATION.md` — resultado da integração pelo Verifier
- `QUALITY-GATES.md` — gates automáticos por risk_score

### Memory Kernel

Memória ativa injetada automaticamente antes de cada run:

```
.oxe/memory/
├── REPO-MEMORY.md      ← decisões arquiteturais, pitfalls, preferências, padrões validados
├── MEMORY-INDEX.json   ← índice com relevance_tags por fase
└── retrieved/          ← snapshots do contexto injetado (auditável por run)
    ├── conduct.md
    ├── agent.md
    └── swarm.md
```

`bin/lib/oxe-memory-kernel.cjs` — `retrieveMemory(intent_tags, phase)` filtra por relevância e ranking; `bin/lib/oxe-skill-loader.cjs` — `selectPersonasForIntent(tags)` mapeia domínios para personas.

### Learning Kernel

Ao final de cada run, `oxe/workflows/distill.md` aciona automaticamente:

```
Run completo
  ↓
Detecta padrões: blocker_pattern, success_pattern, anti_pattern, file_conflict…
  ↓
CANDIDATES.ndjson ← candidatos categorizados
  ↓
LESSONS.md ← dedup: mesma raiz → Frequência++; novo → C-NN-L1
  ↓
lessons-metrics.json ← success_rate; deprecação auto se < 0.5 em 3+ aplicações
  ↓
PROMOTION-QUEUE.md ← skills candidatas para revisão humana
  ↓
REPO-MEMORY.md ← decisões e pitfalls persistidos cross-session
```

---

## Modos de uso

Escolha o ponto de entrada certo para o nível de controle que você quer.

### Autônomo — 1 comando, Conductor decide

Para quando você quer só entregar:

```
/oxe <objetivo em linguagem natural>
```

### Nano — tarefa pontual, sem overhead

```
/oxe-quick → objetivo → passos → verify
```

### Standard — ciclo completo com controle manual

Para features, refatorações ou quando você quer conduzir cada fase:

```
/oxe → /oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify
```

> scan, research, debug, retro e validações especializadas são acionados automaticamente
> pelos estágios corretos ou por flags explícitas (`--research`, `--debug`, `--security`).

### Full — orquestração avançada de times

Para projetos longos, multi-domínio ou com revisão em equipe:

```
/oxe-session new <nome>   ← isola o ciclo numa sessão
/oxe-plan --agents        ← blueprint multi-agente explícito
/oxe-execute              ← runtime tracking, checkpoints e eventos
/oxe-dashboard            ← visão web para revisão de equipe
```

---

## Trilha principal

```
/oxe              → autônomo (Conductor) | status | help | perguntas situacionais
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-spec         → nova feature: perguntas → requisitos → roteiro
                    (absorve scan, research e ui-spec via flags)
/oxe-plan         → tarefas por onda (--agents para multi-agente explícito)
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
/oxe-skill        → skills OXE via @<id> — list, explain, new, @<id>
oxe-cc azure      → autenticar, sincronizar inventário e operar Azure com checkpoint formal
```

---

## Semântica de raciocínio

O OXE distingue cinco famílias de raciocínio aplicadas por cada workflow:

- `discovery` — explorar antes de perguntar; separar fatos, inferências e lacunas
- `planning` — produzir plano decision-complete, com riscos, validação e confidence gate
- `execution` — reconhecimento curto antes de mutar; menor write set viável; validação por fatia
- `review` — findings primeiro, severidade, evidência e risco residual
- `status` — leitura curta do estado, recomendação única e motivo

Contratos em `oxe/workflows/references/reasoning-*.md`, derivados para cada runtime em `.github/prompts/`, `.cursor/commands/`, `commands/oxe/` e `.codex/prompts/`. `oxe/workflows/**` e `workflow-runtime-contracts.json` são contratos obrigatórios da release.

---

## Estado atual do produto

O OXE combina hoje cinco camadas:

- **modo autônomo** — Conductor Agent decide Agent Mode vs Swarm Mode a partir de linguagem natural
- **artefatos canónicos em `.oxe/`** — continuidade entre sessões, IDEs e agentes
- **Memory Kernel** — `REPO-MEMORY.md` + `MEMORY-INDEX.json` + context packs injetados antes de cada run
- **Learning Kernel** — destilação de padrões → `LESSONS.md` (dedup) + `PROMOTION-QUEUE.md` (skills candidatas)
- **runtime TypeScript compilado para CJS** em `packages/runtime/` — ExecutionGraph, scheduler multi-agente (parallel/competitive/cooperative), evidence store, gates, policy, promotion e recovery

O estado operacional real passa por:

```
.oxe/
├── OXE-EVENTS.ndjson         ← tracing append-only, agora efetivamente populado
├── ACTIVE-RUN.json           ← cursor e estado do run atual
├── agent/                    ← artefatos de Agent Mode runs
│   ├── AGENT-SESSION.json
│   ├── MEMORY-INJECTIONS.md
│   ├── SKILLS-LOADED.json
│   └── RECONCILIATION.md
├── swarm/                    ← artefatos de Swarm Mode runs
│   ├── SWARM-RUN.json
│   ├── TASK-GRAPH.json
│   ├── FILE-OWNERSHIP.json
│   ├── BOARD.md / BOARD.json
│   ├── QUALITY-GATES.md
│   ├── FINAL-INTEGRATION.md
│   ├── scout/
│   └── reviews/
├── memory/                   ← Memory Kernel
│   ├── REPO-MEMORY.md
│   ├── MEMORY-INDEX.json
│   └── retrieved/
├── learning/                 ← Learning Kernel
│   ├── CANDIDATES.ndjson
│   ├── PROMOTION-QUEUE.md
│   └── LEARNING-EVENTS.ndjson
├── runs/<run_id>/            ← runtime enterprise por run
│   ├── verification-manifest.json
│   ├── residual-risk-ledger.json
│   ├── evidence-coverage.json
│   └── workspace-merge-report.json
├── execution/GATES.json
└── global/
    └── LESSONS.md            ← lições prescritivas cumulativas
```

Contrato estável desta release:

- `/oxe <objetivo>` → Conductor → Agent Mode ou Swarm Mode (automático)
- `execute` e `verify` são `runtime-first` quando `oxe-cc runtime` está disponível
- `multi-agent` é GA apenas com isolamento real (`git_worktree`)
- `OXE-EVENTS.ndjson` é populado em todo run (RunStarted, WorkItemCompleted, GateRequested, LessonPromoted, RunCompleted)
- `REPO-MEMORY.md` é atualizado automaticamente ao final de Swarm Mode runs

→ [Guia por papel](docs/ROLES.md) · [Quickstart](QUICKSTART.md) · [Walkthrough](docs/WALKTHROUGH.md)

---

## Para times

| Recurso | Link |
|---------|------|
| Primeiros 15 minutos | [QUICKSTART.md](QUICKSTART.md) |
| Guia por papel (executor / reviewer / operador) | [docs/ROLES.md](docs/ROLES.md) |
| Fluxo recomendado para times | [docs/TEAM-ADOPTION.md](docs/TEAM-ADOPTION.md) |
| Exemplo completo reproduzível | [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) |
| Incidentes e gates | [docs/INCIDENT-PLAYBOOK.md](docs/INCIDENT-PLAYBOOK.md) |
| Suporte por runtime (Cursor, Copilot, Claude Code…) | [docs/RUNTIME-SMOKE-MATRIX.md](docs/RUNTIME-SMOKE-MATRIX.md) |
| Release readiness e publicação | [docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md) |

---

## Sessões OXE

Sessões organizam um ciclo completo em `.oxe/sessions/sNNN-slug/` sem misturar artefatos de entregas diferentes na raiz. `spec`, `plan`, `execute`, `verify`, `checkpoint`, `research` e afins respeitam `active_session` em `.oxe/STATE.md`.

```text
.oxe/
├── STATE.md
├── SESSIONS.md
├── global/
│   ├── LESSONS.md
│   └── MILESTONES.md
├── memory/         ← cross-session (não scoped)
├── learning/       ← cross-session (não scoped)
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

---

## A cadeia

```
/oxe <objetivo>
  ↓ Conductor (automático)
  ├── Agent Mode ──────────────────────────── → .oxe/agent/
  └── Swarm Mode (Scout→Builders→Reviewer→Verifier) → .oxe/swarm/
          ↓
     Learning Kernel → .oxe/learning/ + .oxe/global/LESSONS.md
          ↓
     Memory Kernel → .oxe/memory/REPO-MEMORY.md (próximo run lê)

/oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify  (controle manual)
                ↓                            ↓
          /oxe-quick               .oxe/global/LESSONS.md
         (trabalho pequeno)         (alimenta próximo ciclo)
```

**Comportamentos absorvidos por cada estágio:**

| Estágio | Absorve (via flags ou automático) |
|---------|-----------------------------------|
| `/oxe` | Conductor (objetivos), ask (perguntas situacionais), route, status, help |
| `/oxe-spec` | scan (`--refresh`/`--full`), research (`--research`), ui-spec (`--ui`) |
| `/oxe-execute` | obs (`--note`), debug (`--debug`), forensics (`--deep-diagnosis`), checkpoint (`--checkpoint`), loop (`--iterative`) |
| `/oxe-verify` | gaps (`--gaps`), security (`--security`), ui-review (`--ui`), review-pr (`--pr`), retro (automática) |

---

## Como cada comando funciona

| Comando | O que entrega |
|---------|--------------|
| `/oxe` | Com objetivo de implementação → Conductor (Agent/Swarm). Sem input → próximo passo. Com pergunta → situação atual. Com "help" → trilha principal. |
| `/oxe-spec` | **5 fases**: perguntas → pesquisa → requisitos R-ID → roteiro → aprovação. `--refresh`/`--full` fazem scan antes. `--research` ativa spike. `--ui` gera UI-SPEC. Imagem/screenshot no chat → materializa `VISUAL-INPUTS` quando o runtime suportar visão. |
| `/oxe-plan` | **Test-first:** `Verificar` antes de `Implementar`. `PLAN.md` com `## Autoavaliação do Plano`. `--agents` gera `plan-agents.json` (schema v3 com personas e model_hint). |
| `/oxe-execute` | Modos A/B/C. Valida autoavaliação antes de implementar. `--note` → observação. `--debug` → diagnóstico inline. `--deep-diagnosis` → forensics. `--checkpoint` → snapshot. `--iterative` → loop de retry. |
| `/oxe-verify` | Até 6 camadas: audit + critérios + decisões + coerência operacional + calibração + UAT. `--gaps` → cobertura. `--security` → OWASP. `--ui` → UI-REVIEW. `--pr`/`--diff` → revisão de PR. Retro automática ao fechar. |
| `/oxe-quick` | Objetivo → passos → agentes opcionais (PDDA lean) → verify. Para correções pontuais. |
| `/oxe-session` | `new`, `list`, `switch`, `resume`, `status`, `close`, `migrate`, `milestone`, `workstream`. |
| `/oxe-dashboard` | Consolida STATE, PLAN, ACTIVE-RUN, trace log, runtime, checkpoints e verify numa visão visual de ciclo, ondas e aprovação. |
| `/oxe-skill` | `list` (active/proposed/archived/global) · `explain <id>` · `new <id>` · `@<id>` (inline). Resolução: projeto → capabilities → global. |
| `oxe-cc azure` | Provider Azure nativo: autenticação, inventário via Resource Graph, operações guiadas para Service Bus, Event Grid e Azure SQL. |

---

## Personas disponíveis

O OXE tem 8 personas builtin em `oxe/personas/`. O Conductor as seleciona automaticamente por `intent_tags`; você pode invocá-las diretamente em qualquer workflow com `@<id>`:

| ID | Papel | Domínio |
|----|-------|---------|
| `executor` | Implementador de precisão | código, commits atômicos, write set mínimo |
| `planner` | Arquiteto de grafo | decomposição, waves, mutation_scope |
| `verifier` | Auditor cético | verificação 4-camadas, evidence-only |
| `architect` | Design de sistema | boundaries, contratos, decisões D-NN |
| `ui-specialist` | UI/UX | componentes, estados, acessibilidade |
| `db-specialist` | Banco de dados | schema, migrations, N+1, integridade |
| `researcher` | Exploração | descoberta, redução de incerteza, POC |
| `debugger` | Root cause | RCA, hotfix mínimo, reprodução |

Skills de projeto ficam em `.oxe/skills/active/` e têm precedência sobre as globais.

---

## Quando usar cada modo do execute

```
A) Completo   → todas as ondas numa só execução  (ideal: Claude, Copilot, Gemini)
B) Por onda   → onda 1, você verifica, chama de novo  (1 rodada por onda)
C) Por tarefa → máximo controle  (1 rodada por tarefa)
```

Se uma tarefa falha: diagnóstico inline automático (2-3 hipóteses → fix → retry). O Modo B inclui loop iterativo com escalada automática para diagnóstico profundo.

---

## Comportamentos especializados (via flags)

| Comportamento | Como ativar |
|---------------|-------------|
| Scan / refresh do codebase | `/oxe-spec --refresh` ou `--full` |
| Research / spike | `/oxe-spec --research` |
| Contrato UI/UX | `/oxe-spec --ui` |
| Registrar observação durante execução | `/oxe-execute --note "texto"` |
| Diagnóstico técnico inline | `/oxe-execute --debug` |
| Diagnóstico pós-falha persistente | `/oxe-execute --deep-diagnosis` |
| Snapshot nomeado | `/oxe-execute --checkpoint "<nome>"` |
| Loop de retry | `/oxe-execute --iterative` |
| Auditoria de cobertura | `/oxe-verify --gaps` |
| Auditoria OWASP | `/oxe-verify --security` |
| Auditoria de implementação UI | `/oxe-verify --ui` |
| Revisão de PR ou diff | `/oxe-verify --pr` ou `--diff branchA...branchB` |
| Retrospectiva | automática ao fechar `/oxe-verify` (desativar: `--skip-retro`) |

**Compatibilidade:** comandos legados (`/oxe-debug`, `/oxe-forensics`, `/oxe-research`, etc.) continuam funcionando desde v1.1.0 com aviso de migração.

---

## Azure no OXE

Provider Azure nativo, local-first, via Azure CLI. Não guarda segredos no repositório; usa a sessão oficial da CLI e materializa contexto em `.oxe/cloud/azure/`.

```bash
# Autenticação
npx oxe-cc azure auth login [--tenant <entra-tenant-id>]
npx oxe-cc azure auth set-subscription --subscription "<dev-sub-id>"

# Diagnóstico
npx oxe-cc azure doctor
npx oxe-cc azure status

# Inventário
npx oxe-cc azure sync [--diff]
npx oxe-cc azure find servicebus [--type servicebus]

# Operações (com --dry-run disponível)
npx oxe-cc azure servicebus plan --kind namespace --name sb-core --resource-group rg-app --location brazilsouth
npx oxe-cc azure servicebus apply --kind namespace --name sb-core --resource-group rg-app --location brazilsouth --approve
```

Princípios: opt-in, discovery via Resource Graph, mutação só com checkpoint formal, evidência persistida e redacted em `.oxe/cloud/azure/operations/`.

---

## Concepts-chave

### Context engineering — estado em disco, não no chat

```
.oxe/
├── STATE.md              ← índice global: fase, sessão ativa, próximo passo
├── SESSIONS.md           ← índice de sessões
├── CAPABILITIES.md       ← catálogo de capabilities instaladas
├── ACTIVE-RUN.json       ← cursor e estado durável do run atual
├── OXE-EVENTS.ndjson     ← tracing append-only (populado em todo run)
├── agent/                ← artefatos de Agent Mode
├── swarm/                ← artefatos de Swarm Mode
├── memory/               ← Memory Kernel (cross-session)
├── learning/             ← Learning Kernel (cross-session)
├── cloud/azure/          ← profile, auth-status, inventory e operações Azure
├── global/
│   ├── LESSONS.md        ← lições prescritivas cumulativas
│   └── MILESTONES.md     ← marcos globais de entrega
├── codebase/             ← mapa do repo (stack, estrutura, testes…)
└── sessions/
    └── sNNN-slug/
        ├── spec/         ← SPEC.md, ROADMAP.md, DISCUSS.md, UI-SPEC.md
        ├── plan/         ← PLAN.md, QUICK.md, blueprints de agentes
        ├── execution/    ← STATE.md local, OBSERVATIONS.md, DEBUG.md
        ├── verification/ ← VERIFY.md, VALIDATION-GAPS.md, SECURITY.md
        ├── checkpoints/
        ├── research/
        └── workstreams/
```

### `/oxe-spec` — spec em 5 fases com auto-reflexão

1. **Perguntas** — blocos de 3-5 por rodada, máximo 3 rodadas
2. **Pesquisa** — proposta inline na Fase 2 com investigações estruturadas
3. **Requisitos** — tabela R-ID com v1/v2/fora e critérios A*
4. **Roteiro** — fases de entrega → `.oxe/ROADMAP.md`
5. **Auto-reflexão** — detecta contradições, critérios vagos, escopo creep, conflitos com stack
6. **Aprovação** → instrui `/oxe-plan` ou `/oxe-plan --agents`

A spec lê `.oxe/global/LESSONS.md` e `.oxe/memory/REPO-MEMORY.md` antes de iniciar.

### `/oxe-plan` — test-first com complexidade explícita

Cada tarefa usa a ordem **Verificar → Implementar**:
```
Verificar: como saberei que está pronto?   ← definido PRIMEIRO
Implementar: o mínimo para passar o Verificar
Complexidade: S | M | L | XL
```

Tarefas `XL` bloqueiam o gate sem sub-tarefas ou justificativa. `/oxe-obs` propaga automaticamente constraints para R-IDs e Tns afetados.

### Learning loop completo

```
/oxe-verify completo (ou Swarm Verifier)
     ↓
distill.md → detecta padrões do run
     ↓
.oxe/learning/CANDIDATES.ndjson
     ↓
.oxe/global/LESSONS.md (dedup: Frequência++ se mesma raiz)
     ↓
lessons-metrics.json (success_rate, deprecação automática)
     ↓
.oxe/learning/PROMOTION-QUEUE.md (skills candidatas → revisão humana)
     ↓
/oxe-skill new <id> (promove skill aprovada)
     ↓
próximo run: Conductor carrega skill como persona ativa
```

### Runtime tracking e inspeção no terminal

```bash
oxe-cc status --full          # health + coverage matrix + readiness gate
oxe-cc runtime status         # run ativo, cursor, onda atual
oxe-cc runtime verify         # suite + evidence + manifest + risk ledger
oxe-cc runtime gates list
oxe-cc runtime agents --json
oxe-cc runtime promote --target pr_draft
```

### Dashboard web — opt-in para revisões de equipe

`oxe-cc dashboard` sobe uma interface web local para revisar o plano antes da execução — indicado para apresentações, operação de gates e revisões em equipe. Lê os artefatos OXE reais (não é uma segunda fonte de verdade). Inclui: ciclo principal, mapa de artefatos, active run, trace log, trilha de ondas, handoffs, checkpoints, agentes, evidências, gates e promotion state.

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
| `--local` | Layout mínimo, só `.oxe/` (padrão) |
| `--ide-local` | Instala integração no próprio repositório |
| `--ide-global` | Instala integração no HOME do utilizador |
| `--force` / `-f` | Sobrescreve arquivos existentes (use para atualizar) |
| `--dry-run` | Lista ações sem escrever |
| `--oxe-only` | Só workflows em `.oxe/`, sem integrações IDE |
| `--no-global-cli` / `-l` | Não instala `oxe-cc` globalmente (útil em CI) |
| `OXE_NO_PROMPT=1` | Modo não-interativo (CI) |

</details>

<details>
<summary><strong>Atualizar e desinstalar</strong></summary>

```bash
npx oxe-cc@latest --force        # atualizar workflows
npx oxe-cc update --check        # verificar versão sem atualizar
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
| `oxe-cc doctor` | Diagnóstico completo: Node, workflows, contratos semânticos, config, sessão ativa, saúde lógica (`healthy` \| `warning` \| `broken`) |
| `oxe-cc doctor --release --write-manifest` | Gate de publicação: valida árvore canónica, `workflow-runtime-contracts.json`, versões, CHANGELOG, runtime compilado; persiste `release-manifest.json` |
| `oxe-cc status` | Próximo passo sugerido + saúde lógica |
| `oxe-cc status --full` | Coverage matrix + readiness gate + active run (ANSI) |
| `oxe-cc status --json` | Estado completo em JSON (schema v5): workspaceMode, healthStatus, activeSession, planSelfEvaluation, contextQuality, semanticsDrift, verificationSummary, pendingGates, multiAgent, promotionSummary e mais |
| `oxe-cc context build` | Gera context pack em `.oxe/context/packs/` por contrato de workflow |
| `oxe-cc context inspect` | Inspeciona context pack sem escrita |
| `oxe-cc update` | Atualiza workflows para a versão mais recente |
| `oxe-cc init-oxe` | Bootstrap do `.oxe/` |
| `oxe-cc dashboard` | Interface web local para revisão, comentários e aprovação |
| `oxe-cc runtime <status\|start\|pause\|resume\|replay\|compile\|verify\|project\|ci\|promote\|recover\|gates\|agents>` | Controla o runtime enterprise |
| `oxe-cc runtime gates <list\|show\|resolve>` | Lista, inspeciona e resolve gates operacionais |
| `oxe-cc runtime agents status` | Ownership, handoffs, heartbeats e failover multi-agent |
| `oxe-cc runtime promote --target pr_draft` | Promoção remota governada por verify, gates, risk e coverage |
| `oxe-cc runtime recover` | Reidrata journal, gates, evidence e estado canónico |
| `oxe-cc capabilities <list\|install\|remove\|update>` | Mantém catálogo de capabilities em `.oxe/` |
| `oxe-cc plugins <list\|install\|remove>` | Gerencia plugins de lifecycle |
| `oxe-cc uninstall` | Remove integrações OXE |
| `oxe-cc uninstall --global-cli` | Também remove o pacote npm global |

---

## Configuração

Arquivo `.oxe/config.json`. Principais opções:

| Chave | Padrão | Descrição |
|-------|--------|-----------|
| `profile` | `"balanced"` | `strict` / `balanced` / `fast` / `legacy` |
| `verification_depth` | `"standard"` | `"thorough"` ativa gaps automático no verify |
| `plan_confidence_threshold` | `90` | Limiar para `execute` aceitar um `PLAN.md` |
| `security_in_verify` | `false` | `true` ativa OWASP automático no verify |
| `discuss_before_plan` | `false` | Exige aprovação de decisões antes do plano |
| `scale_adaptive` | `true` | Scan sugere o profile pelo tamanho do projeto |
| `plugins` | `[]` | Hooks de lifecycle em `.oxe/plugins/*.cjs` |
| `permissions` | `[]` | Regras glob+ação para gate de arquivos em execute/apply |
| `runtime.quotas.*` | `Infinity` | Limites enterprise para work items, mutações e retries por run |

---

## SDK

```js
const oxe = require('oxe-cc');

const plan  = oxe.parsePlan(fs.readFileSync('.oxe/PLAN.md', 'utf8'));
const spec  = oxe.parseSpec(fs.readFileSync('.oxe/SPEC.md', 'utf8'));
const state = oxe.parseState(fs.readFileSync('.oxe/STATE.md', 'utf8'));

const fidelity = oxe.validateDecisionFidelity(discussMd, planMd);
const result   = oxe.runDoctorChecks({ projectRoot: process.cwd() });

async function verifyActiveRun() {
  return oxe.verifyRun?.({
    projectRoot: process.cwd(),
    runId: 'oxe-run-123',
    workItemId: 'T1',
    cwd: process.cwd(),
  });
}
```

O SDK reexporta bridges do runtime enterprise: `verifyRun`, `operational.buildRuntimePluginRegistry`, `operational.readRuntimeGates`, `operational.resolveRuntimeGate`, `operational.runRuntimeVerify`, `operational.runRuntimePromotion`, `operational.recoverRuntimeState`.

TypeScript: [`lib/sdk/index.d.ts`](lib/sdk/index.d.ts) · Docs: [`lib/sdk/README.md`](lib/sdk/README.md)

---

## Critérios de publicação

O pacote está pronto para publicação quando estes sinais estiverem verdes:

```bash
npm test
npm run scan:assets
npm run build:vscode-ext
node bin/oxe-cc.js doctor --release --write-manifest
npm run release:pack-check
node bin/oxe-cc.js status --full
```

Artefatos obrigatórios: `release-manifest.json`, `runtime-smoke-report.json`, `runtime-real-report.json`, `recovery-fixture-report.json`, `multi-agent-soak-report.json`, `multi-agent-real-report.json` em `.oxe/release/`.

---

## Resolução de problemas

| Situação | O que tentar |
|----------|-------------|
| Comandos não aparecem no Cursor | Confirme `~/.cursor/commands/`; reinicie o Cursor |
| `/oxe-*` não aparecem no Copilot | Ative `"chat.promptFiles": true`; confirme `.github/prompts/` e `.github/copilot-instructions.md` |
| Copilot responde fora do workflow OXE | `npx oxe-cc doctor`; se houver blocos mistos de outros frameworks, `npx oxe-cc uninstall --copilot-legacy-clean` |
| Runtime não responde com nova semântica | Verifique drift entre `oxe/workflows/` e prompts instalados; `npm run sync:runtime-metadata` |
| Arquivos não atualizam | `npx oxe-cc@latest --force` |
| `ETARGET` / versão não encontrada | `npm cache clean --force` |
| Erro no WSL sobre Node | Use Node instalado dentro do WSL |

`oxe-cc --help` · `oxe-cc doctor` · `OXE_NO_BANNER=1` desativa o banner

---

## Licença

[MIT](LICENSE)
