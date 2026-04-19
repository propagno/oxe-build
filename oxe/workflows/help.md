# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → research opcional → plan → execução → verify → validate-gaps opcional), o modo **quick**, o passo **execute**, e **como invocar em várias IDEs/CLIs** (Cursor e GitHub Copilot como referência principal; outras stacks na secção multi-agente). Mencionar o CLI `oxe-cc` (instalar, `doctor`, `status`, `init-oxe`, `uninstall`, `update`) e, em linha, o **SDK** npm (`require('oxe-cc')`) para CI.
</objective>

<context>
Aplicar `oxe/workflows/references/reasoning-status.md`. A ajuda deve ser curta, orientada a decisão e explícita sobre o próximo passo recomendado.

OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no projeto alvo — **o núcleo é o mesmo** em Cursor, Copilot, Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity ou outra CLI suportada pelo instalador. **Poucos comandos** por ferramenta em relação a fluxos de planeamento mais pesados; *context engineering* com arquivos pequenos por etapa. **GitHub Copilot (VS Code)** é **workspace-first**: o `oxe-cc` escreve `.github/copilot-instructions.md` e `.github/prompts/` no projeto. `~/.copilot/` fica para o runtime do **Copilot CLI** e para limpeza de legado detectável, não como fonte primária da IDE.

O OXE distingue cinco famílias de raciocínio multi-runtime: `discovery`, `planning`, `execution`, `review` e `status`. Essa semântica nasce em `oxe/workflows/references/reasoning-*.md`, entra nos workflows canónicos e é renderizada nos prompts/skills de cada runtime. A mesma etapa deve produzir respostas mais exploratórias, decision-complete e auditáveis em qualquer agente suportado.

No **projeto**, os passos canónicos estão em **`.oxe/workflows/*.md`** (layout mínimo) ou **`oxe/workflows/*.md`** (layout clássico com `--global`); no **pacote npm**, os modelos vivem em **`oxe/workflows/*.md`**.
</context>

<output>
## Modos de uso

Escolha a complexidade certa. Comece simples e adicione estrutura quando precisar.

**Nano** — 1 comando, zero overhead:
```
/oxe-quick
```

**Standard** — ciclo completo para features e refatorações:
```
/oxe → /oxe-spec → /oxe-plan → /oxe-execute → /oxe-verify
```

> scan, research, debug, retro e validações especializadas são acionados automaticamente
> dentro dos estágios corretos ou por flags explícitas.

**Full** — sessões, multi-agente, dashboard, capabilities:
```
/oxe-session new <nome> → /oxe-plan --agents → /oxe-execute → /oxe-dashboard (opt-in)
```

---

## Trilha principal

Estes são os únicos comandos que você precisa conhecer para seguir o framework:

```
/oxe              → onde estou / o que faço / help (entrada universal + perguntas situacionais)
/oxe-quick        → tarefa pequena, sem cerimônia (com agentes lean quando necessário)
/oxe-spec         → nova feature: perguntas → pesquisa → requisitos → roteiro → aprovação
                    Absorve: scan (--refresh / --full), research (--research / --deep), ui-spec (--ui)
/oxe-plan         → tarefas por onda (--agents para blueprint multi-agente)
/oxe-execute      → implementar (A: 1 sessão | B: por onda | C: por tarefa)
                    Absorve: obs (--note), debug (--debug), forensics (--deep-diagnosis),
                             checkpoint (--checkpoint), loop (--iterative)
/oxe-verify       → validar e fechar o ciclo
                    Absorve: gaps (--gaps), security (--security), ui-review (--ui),
                             review-pr (--pr / --diff), retro (automático)
```

## Trilha avançada

```
/oxe-session      → criar, alternar, retomar, fechar ou migrar sessões OXE
/oxe-dashboard    → visão web opt-in para revisão de equipe e aprovação do plano
```

## Comandos administrativos e plataforma

```
/oxe-capabilities → listar, instalar, remover ou atualizar capabilities nativas do projeto
/oxe-skill        → descobrir, invocar e gerenciar skills OXE via @<id>
oxe-cc azure      → autenticar, sincronizar inventário e operar Azure com checkpoint formal
```

Tudo o mais é ativado automaticamente por contexto, por config, ou existe como flag dos estágios principais.

---

## Sessões OXE

- `active_session` em `.oxe/STATE.md` define a sessão ativa com path relativo completo (`sessions/sNNN-slug`).
- Com sessão ativa, workflows de spec/plan/execute/verify e suportes ligados à trilha escrevem em `.oxe/<active_session>/...`.
- Permanecem globais: `.oxe/STATE.md`, `.oxe/config.json`, `.oxe/codebase/`, `.oxe/SESSIONS.md`, `.oxe/global/LESSONS.md`, `.oxe/global/MILESTONES.md`.
- `oxe-cc status` / `doctor` devem refletir a sessão ativa, a autoavaliação do plano e a saúde lógica do fluxo.
- O escopo ativo também pode ter `EXECUTION-RUNTIME.md`, `CHECKPOINTS.md` e `INVESTIGATIONS.md` para operação, approvals e evidência.
- Quando o projeto usa Azure, o provider nativo materializa `.oxe/cloud/azure/profile.json`, `auth-status.json`, `inventory.json` e `INVENTORY.md`; estes artefatos alimentam `ask`, `spec`, `plan`, `execute`, `verify`, `status`, `doctor` e o dashboard.

### `/oxe-session`

- `new <nome>` — cria `.oxe/sessions/sNNN-slug/` e ativa a sessão
- `list` — mostra `.oxe/SESSIONS.md`
- `switch <id>` / `resume <id>` — alterna a sessão ativa
- `status` — mostra o manifesto `SESSION.md`
- `close` — arquiva a sessão ativa
- `migrate <nome>` — move artefatos session-scoped da raiz para uma nova sessão

## Integrações principais (referência)

### Cursor

Slash commands da trilha principal: `/oxe`, `/oxe-quick`, `/oxe-spec`, `/oxe-plan`, `/oxe-execute`, `/oxe-verify`

Slash commands avançados: `/oxe-session`, `/oxe-dashboard`

Slash commands administrativos / plataforma: `/oxe-capabilities`, `/oxe-skill`, `/oxe-update`

Slash commands legados (ainda funcionam, exibem aviso de migração): `/oxe-ask`, `/oxe-obs`, `/oxe-scan`, `/oxe-research`, `/oxe-debug`, `/oxe-forensics`, `/oxe-loop`, `/oxe-checkpoint`, `/oxe-ui-spec`, `/oxe-ui-review`, `/oxe-security`, `/oxe-validate-gaps`, `/oxe-review-pr`, `/oxe-retro`, `/oxe-project`, `/oxe-compact`, `/oxe-route`, `/oxe-next`, `/oxe-discuss`, `/oxe-plan-agent`, `/oxe-milestone`, `/oxe-workstream`, `/oxe-help` (instalados em `~/.cursor/commands/` pelo `oxe-cc`).

### GitHub Copilot (VS Code)

1. **Instruções do workspace:** arquivo **`.github/copilot-instructions.md`** (conteúdo mesclado pelo instalador; contém o bloco OXE entre marcadores).
2. **Prompt files:** em **`.github/prompts/`** (ex.: `oxe-scan.prompt.md`). No chat, `/` e escolha **`oxe-scan`**, **`oxe-spec`**, etc. Requer `"chat.promptFiles": true` (exemplo em `.vscode/settings.json` do repo com layout `--global`).
3. **`/oxe-review-pr`** — revisão de PR/diff (prompt no workspace; fluxo em `review-pr.md`).
4. Se existir conteúdo OXE em `~/.copilot/prompts/`, trate como legado e limpe com `npx oxe-cc uninstall --copilot-legacy-clean`.

**Checkpoint vs compact (rotina de contexto em disco):**

| Aspeto | `/oxe-checkpoint` | `/oxe-compact` |
|--------|-------------------|----------------|
| Escopo | Sessão / trilha atual | Projeto inteiro |
| Tempo | Curto prazo | Longo prazo |
| Foco | Progresso (onde parei) | Conhecimento (como o repo é hoje) |
| Uso | Pausar / retomar com nome | Evoluir mapa + resumo OXE |
| Output | Snapshot em `.oxe/checkpoints/` | `.oxe/codebase/*` + `CODEBASE-DELTA.md` + `RESUME.md` |

### Momentos chave (rotina)

Sugestão para integrar **checkpoint** e **compact** no dia a dia (não são obrigatórios do fluxo canónico; ver `compact.md` / `checkpoint.md`):

| Momento | `/oxe-checkpoint` | `/oxe-compact` |
|---------|-------------------|----------------|
| Antes de branch longa ou spike arriscado | Sim (slug + nota) | Opcional se o mapa já reflete o repo |
| Após migração de stack (ex.: Angular 17 → 21) | Opcional | Sim — alinhar `.oxe/codebase/` ao código + `CODEBASE-DELTA.md` |
| Fim de feature / antes de PR grande | Opcional | Sim — reduzir drift entre doc OXE e implementação |
| Fim de dia com trabalho a meio | Sim | Não obrigatório |
| Pós-`verify_complete`, antes de nova entrega | Opcional (estado estável) | Opcional refresh dos mapas |

Com **`compact_max_age_days`** em `.oxe/config.json` (ver `oxe/templates/CONFIG.md`), **`oxe-cc doctor`** / **`status`** podem avisar quando o último compact em `STATE.md` está antigo.

## Fluxo completo

0. **situação** — `/oxe "pergunta"` responde com base nos artefatos reais. Sem input: próximo passo.
1. **spec** — fluxo em **5 fases**: perguntas (máx 3 rodadas) → pesquisa (proposta inline na Fase 2, sem sair do spec) → requisitos R-ID (v1/v2/fora) → roteiro (`.oxe/ROADMAP.md`) → aprovação.
   - `/oxe-spec --refresh` — atualiza o mapa do codebase antes de spec (modo incremental)
   - `/oxe-spec --full` — força scan completo antes de spec
   - `/oxe-spec --research` — ativa pesquisa/spike explícita na Fase 2
   - `/oxe-spec --ui` — gera contrato UI-SPEC ao final da spec
   - Se `discuss_before_plan: true` na config, o próximo passo após aprovação é `oxe:discuss` antes de plan.
2. **plan** — plano executável + **Verificar** por tarefa. Se 3+ domínios distintos, **sugere automaticamente** blueprint de agentes (`/oxe-plan --agents`). Sem `--agents`: solo. Com `--agents`: gera também `plan-agents.json` (schema 3 com `model_hint`).
3. **execute** — modo selecionado 1 vez: **A) Completo** (1 sessão), **B) Por onda**, **C) Por tarefa**. Antes de executar, valida a **Autoavaliação do Plano**. Se Verificar falhar inline: diagnóstico automático (2-3 hipóteses + fix). Escalação automática para diagnóstico profundo se esgotar tentativas.
   - `/oxe-execute --note "texto"` — registra observação contextual durante a execução
   - `/oxe-execute --debug` — ativa diagnóstico técnico explícito (stack trace, teste vermelho)
   - `/oxe-execute --deep-diagnosis` — diagnóstico pós-falha persistente + caminho de reentrada
   - `/oxe-execute --checkpoint "nome"` — cria snapshot nomeado do estado da sessão
   - `/oxe-execute --iterative` — loop de retry até verify passar (Modo B com `loop_max`)
4. **verify** — até **6 camadas** por config: auditoria pré-exec, tarefas + critérios A*, fidelidade D-NN, **coerência operacional** (runtime + checkpoints), **calibração do plano**, UAT, **gaps de cobertura**, **segurança OWASP**. Sem comandos extras.
   - `/oxe-verify --gaps` — ativa auditoria de cobertura explicitamente (Camada 5)
   - `/oxe-verify --security` — ativa auditoria OWASP explicitamente (Camada 6)
   - `/oxe-verify --ui` — inclui auditoria de implementação UI (exige UI-SPEC.md)
   - `/oxe-verify --pr` — inclui revisão de PR ou diff de branches
   - `/oxe-verify --diff branchA...branchB` — revisão de diff específico
   - `/oxe-verify --skip-retro` — pula a retrospectiva automática ao final
   - **Retro automática:** ao fechar `verify_complete`, sintetiza 3–5 lições em `.oxe/LESSONS.md` (pode ser desativada com `--skip-retro`).
5. **→ próximo ciclo** — spec/plan do próximo ciclo lê LESSONS.md automaticamente.

**Gestão de projeto (`/oxe-project`):**

Um único comando para: `milestone new|complete|status|audit`, `workstream new|switch|list|close <nome>`, `checkpoint [slug]`. Sem argumento: mostra status atual.

**Vertical UI (opcional, mesma trilha):**

- **`/oxe-ui-spec`** — após **spec**, contrato `.oxe/UI-SPEC.md` antes ou para alimentar o **plan** (ver `ui-spec.md`).
- **`/oxe-ui-review`** — após implementação UI, auditoria `.oxe/UI-REVIEW.md` antes ou como entrada para **verify** (ver `ui-review.md`).

## Modo rápido (quick) com Plan-Driven Dynamic Agents lean

- **`/oxe-quick`**: cria `.oxe/QUICK.md` (passos curtos + verificar) sem SPEC/PLAN longos, integrando o conceito de **Plan-Driven Dynamic Agents (lean)**:

  | Princípio | Como se manifesta no Quick |
  |-----------|---------------------------|
  | **Spec-Driven Design** | `## Objetivo` é a minispec — restringe o escopo de todos os agentes e passos |
  | **Spec-Driven Development** | `## Passos` é o mini-plano — os agentes são derivados dos passos, não os definem |
  | **Plan-Driven Dynamic Agents** | Agentes criados **a partir dos passos**, para **esta demanda**, invalidados ao terminar |

  **Quando ativar agentes:** tarefa com 2+ domínios distintos (ex.: backend + frontend), 5+ passos que agrupam naturalmente, ou flag `--agents`. Máx. 3 agentes — se precisar de mais, promover para `/oxe-plan-agent`.

  **Artefatos com agentes:** além de `.oxe/QUICK.md` (com seção `## Agentes dinâmicos`), cria **`.oxe/quick-agents.json`** (schema lean; `status: active` → `done` após verify). Sem handoff de mensagens entre agentes (lean — sem `.oxe/plan-agent-messages/`).

  **Perfil fast (sem agentes):** objetivo numa frase, ≤10 passos, verificação. **Promova** para spec/plan se o trabalho crescer (muitos arquivos, API pública, segurança, ou > 3 domínios). Se existir **`.oxe/plan-agents.json`** (schema 2) ainda activo, o quick **invalida** o blueprint — não reutilizar esses agentes neste fluxo; para novo roteiro com agentes, **`/oxe-plan-agent`**.

## CLI (terminal)

- **`npx oxe-cc`** ou **`npx oxe-cc install`** — mesma instalação (alias explícito).
- Instala workflows em `.oxe/` (layout mínimo) ou `oxe/` + `.oxe/` com **`--global`**; integrações em `~/.cursor`, `.github/` (Copilot VS Code), `~/.claude`, `~/.copilot/skills` (Copilot CLI) e mais destinos com **`--copilot-cli`** / **`--all-agents`**.
- **`oxe-cc doctor`** — Node, workflows do pacote vs projeto, `config.json`, bootstrap mínimo de `.oxe/`, mapas do codebase, **coerência STATE vs arquivos**, sessão ativa, autoavaliação do plano, scan antigo (`scan_max_age_days`), compact antigo (`compact_max_age_days`), seções SPEC, ondas do PLAN e **saúde lógica** (`healthy` | `warning` | `broken`).
- **`oxe-cc status`** — coerência `.oxe/` + **um** próximo passo (espelha `next.md`). Com **`--full`**, visão ANSI extendida: coverage matrix (SPEC/PLAN/VERIFY/LESSONS), readiness gate e active run — caminho padrão de inspeção no terminal. Com **`--json`**, uma linha JSON com `healthStatus`, `activeSession`, `planSelfEvaluation` e `diagnostics` completos. Com **`--hints`**, bloco **Lembretes (rotina OXE)**.
- **`oxe-cc dashboard`** — UI web opt-in em `localhost` para revisão de equipe e aprovação do plano; use `oxe-cc status --full` para inspeção diária no terminal. Fonte de verdade: apenas artefatos OXE reais, incluindo `ACTIVE-RUN.json` e `OXE-EVENTS.ndjson`.
- **`oxe-cc runtime`** — controla explicitamente `ACTIVE-RUN.json`, `runs/` e `OXE-EVENTS.ndjson` com ações `start`, `pause`, `resume`, `replay` e `status`.
- **`oxe-cc azure`** — provider Azure local-first via Azure CLI (opt-in, apenas quando o projeto usa Azure): `status`, `doctor`, `auth login [--tenant <id>]`, `auth set-subscription --subscription <id>`, `sync [--diff]`, `find [--type] [--filter-rg]`, `servicebus`, `eventgrid`, `sql`, `operations list`. Flags: `--dry-run`, `--vpn-confirmed`. **Fluxo corporativo Entra ID:** `auth login --tenant <tenant-id>` → `auth set-subscription --subscription <dev-sub-id>`.
- **`oxe-cc init-oxe`** — só bootstrap `.oxe/` (STATE, config, codebase).
- **`oxe-cc uninstall`** — remove integrações no HOME e, por omissão, pastas de workflows no repo (`--ide-only` só HOME).
- **`oxe-cc uninstall --global-cli`** — além da limpeza dos artefatos OXE, executa `npm uninstall -g oxe-cc` para remover o binário global do PATH.
- **`/oxe-update`** (Cursor; noutras ferramentas use o terminal no projeto) — workflow de atualização: verificar npm, correr `oxe-cc update`, `doctor`.
- **`oxe-cc update --check`** — só comparar versão em execução com a `latest` no npm (sem instalar).
- **`oxe-cc update --if-newer`** — só executa o `npx oxe-cc@latest` se houver versão mais nova no npm.
- **`oxe-cc update` / `npx oxe-cc@latest --force`** — atualizar ficheiros OXE no projeto. Aceita flags extras como `--ide-local`, `--cursor`, `--copilot`, `--copilot-cli`, `--global`, `--global-cli`.

**CI / sem perguntas:** `OXE_NO_PROMPT=1` — layout mínimo e integrações padrão no HOME, salvo flags (`--global`, `--cursor`, …). Se existir **`.oxe/config.json`** com bloco **`install`** (perfil, `repo_layout`), aplica-se quando **não** há flags IDE explícitas; para ignorar: **`--no-install-config`**. Detalhes: `oxe/templates/CONFIG.md`.

**Flags úteis (resumo):** `--force` / `-f`, `--dry-run`, `--all` / `-a` (Cursor+Copilot VS Code), `--copilot-vscode`, `--copilot-cli`, `--oxe-only`, `--no-init-oxe`, `--global` / `--local`, `--all-agents`, `--vscode` (com `--global`), `--no-global-cli` / `-l`, `--config-dir` / `-c` (uma IDE de cada vez, exceto `--copilot`), `--dir <pasta>`. Ajuda completa: `oxe-cc --help`.

**WSL:** usar Node instalado **no** WSL; o instalador recusa Node do Windows dentro do WSL.

## Router (linguagem natural)

Um pedido → **um** destino (sem gerar contrato). O agente aplica `route.md` ou usa esta tabela:

| Se o utilizador disser (exemplos) | Comando / ação |
|-----------------------------------|----------------|
| Não sei que passo OXE sou / “o que faço agora?” | `/oxe` ou `npx oxe-cc status` |
| Quero entender rapidamente a situação real da trilha atual | `/oxe “pergunta”` |
| Acabei de clonar / falta OXE no projeto | `npx oxe-cc@latest` (ou `oxe-cc`) na raiz do repo |
| Verify falhou várias vezes / doctor estranho / artefatos incoerentes | `/oxe-execute --deep-diagnosis` |
| Teste ou erro técnico durante o trabalho (stack, flake) | `/oxe-execute --debug` (com **Tn** se houver) |
| Revisar diff / PR antes do merge | `/oxe-verify --pr` ou `/oxe-verify --diff branchA...branchB` |
| O que é OXE / lista de passos | `/oxe help` |
| Pesquisa técnica, spike, mapa de sistema grande, engenharia reversa, modernização antes do plano | `/oxe-spec --research` |
| Quero registrar uma observação (restrição, descoberta, preferência) durante ou fora de execução | `/oxe-execute --note “texto”` |
| Quero executar todo o plano de uma vez (1 sessão) | `/oxe-execute` → escolher opção A (Completo) |
| Quero executar onda por onda com verificação entre ondas | `/oxe-execute` → escolher opção B (Por onda) |
| Gaps de cobertura de verificação / Nyquist-lite após verify | `/oxe-verify --gaps` |
| Mapa OXE desatualizado / quero sincronizar codebase com o código sem scan completo | `/oxe-spec --refresh` |
| Quero gravar um marco nomeado da sessão (antes de experimento grande) | `/oxe-execute --checkpoint “<nome>”` |
| Plano com **blueprint de agentes** (JSON + mesmo PLAN.md) / subagentes por onda | `/oxe-plan-agent` |
| Criar marco de entrega / versão / milestone | `/oxe-session milestone new [nome]` |
| Verificar se o milestone está pronto para fechar | `/oxe-session milestone audit` |
| Trabalho paralelo em trilhas separadas / feature branch OXE | `/oxe-session workstream new <nome>` |
| Alternar entre trilhas de desenvolvimento | `/oxe-session workstream switch <nome>` |

---

## Compatibilidade (v1.1.0)

Os comandos abaixo continuam funcionando mas foram incorporados pelos estágios principais:

| Comando legado | Novo destino | Aviso exibido |
|----------------|--------------|---------------|
| `/oxe-ask` | `/oxe “pergunta”` | sim |
| `/oxe-scan` | `/oxe-spec --refresh` | sim |
| `/oxe-research` | `/oxe-spec --research` | sim |
| `/oxe-ui-spec` | `/oxe-spec --ui` | sim |
| `/oxe-obs` | `/oxe-execute --note` | sim |
| `/oxe-debug` | `/oxe-execute --debug` | sim |
| `/oxe-forensics` | `/oxe-execute --deep-diagnosis` | sim |
| `/oxe-checkpoint` | `/oxe-execute --checkpoint` | sim |
| `/oxe-loop` | `/oxe-execute --iterative` | sim |
| `/oxe-validate-gaps` | `/oxe-verify --gaps` | sim |
| `/oxe-security` | `/oxe-verify --security` | sim |
| `/oxe-ui-review` | `/oxe-verify --ui` | sim |
| `/oxe-review-pr` | `/oxe-verify --pr` | sim |
| `/oxe-retro` | `/oxe-verify` (retro automática) | sim |
| `/oxe-project` | `/oxe-session milestone\|workstream` | sim |

## Observações Contextuais (`/oxe-obs`)

**Princípio:** *observation-without-re-explaining* — registre uma observação em 1 request; ela é incorporada automaticamente nos workflows seguintes sem precisar re-explicar.

```
/oxe-obs JWT expiration deve ser via env var JWT_EXPIRES_IN, não hardcoded
```

- **Quando usar:** durante execute (descoberta técnica), após scan (restrição identificada), após spec (ajuste de escopo), a qualquer momento
- **Impacto:** classificado automaticamente em `spec` | `plan` | `execute` | `all`
- **Auto-incorporação:** o próximo `/oxe-spec` (Fase 3), `/oxe-plan`, `/oxe-discuss` ou `/oxe-execute` lê `.oxe/OBSERVATIONS.md` e aplica observações pendentes sem prompt extra
- **Urgência execute:** se chamado durante `executing` com impacto execute, oferece pausar onda atual ou continuar

## Notas pré-trilha (opcional)

- Ficheiro **`.oxe/NOTES.md`**: bullets `YYYY-MM-DD — …` como fila leve (**não** substitui SPEC). Em **`/oxe-discuss`**, **`/oxe-plan`** e **`/oxe-plan-agent`**, consumir ou marcar descartado/adiado.

## Milestones e Workstreams

- **`/oxe-milestone new [nome]`** — iniciar marco de entrega (M-01, M-02, …); registrado em `.oxe/MILESTONES.md`.
- **`/oxe-milestone complete`** — fechar milestone ativo, arquivar artefatos em `.oxe/milestones/M-NN/`.
- **`/oxe-milestone status`** / **`/oxe-milestone audit`** — progresso e Definition of Done.
- **`/oxe-workstream new <nome>`** — trilha paralela em `.oxe/workstreams/<nome>/`.
- **`/oxe-workstream switch <nome>`** — definir workstream ativo; workflows operam nos artefatos dessa trilha.
- **`/oxe-workstream list`** / **`/oxe-workstream close <nome>`** — gerenciar trilhas.

## Personas de agentes

Arquivos em `oxe/personas/` (ou `.oxe/personas/` após instalação) definem comportamentos de agentes para uso com `/oxe-plan-agent`. Personas builtin: `executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist`, `db-specialist`. Personas customizadas do projeto ficam em `.oxe/personas/`.

## Profiles de execução

O campo `profile` em `.oxe/config.json` expande automaticamente múltiplas keys:
- **`balanced`** (padrão): cerimônia moderada, verificação standard.
- **`strict`**: discuss obrigatório, verificação 4 camadas, UAT, aviso de scan antigo.
- **`fast`**: sem discuss, verificação quick, sem UAT.
- **`legacy`**: discuss obrigatório, verificação thorough, sem comando de test assumido.

## SDK (API programática)

Quem integra em pipeline pode usar **`require('oxe-cc')`** (entrada `main` do pacote):
- **`runDoctorChecks({ projectRoot })`** — gate em CI.
- **`parsePlan(planMd)`** — extrai tarefas, ondas, decisões e metadata de PLAN.md.
- **`parseSpec(specMd)`** — extrai critérios A* e seções obrigatórias.
- **`parseState(stateMd)`** — extrai fase, scan date, workstreams, milestone ativo.
- **`validateDecisionFidelity(discussMd, planMd)`** — verifica cobertura de decisões D-NN.
- **`security.checkPathSafety(path, root)`** — valida caminhos contra path traversal e segredos.
- **`plugins.loadPlugins(projectRoot)`** / **`plugins.runHook(plugins, hook, ctx)`** — plugin lifecycle.
- **`health.expandExecutionProfile(profile)`** — expande profile em keys individuais.

Ver **`lib/sdk/README.md`** e **`lib/sdk/index.d.ts`**.

## Variáveis de ambiente (referência)

| Variável | Uso |
|----------|-----|
| `OXE_NO_PROMPT` | `1` / `true`: sem menus interativos |
| `OXE_NO_BANNER` | `1` / `true`: sem banner no CLI |
| `OXE_UPDATE_SKIP_REGISTRY` | `1` / `true`: não consultar npm em `update --check` / `--if-newer` (saída `2` ou skip) |
| `CURSOR_CONFIG_DIR` | Base Cursor (default `~/.cursor`) |
| `COPILOT_CONFIG_DIR` / `COPILOT_HOME` | Base do Copilot CLI e do legado detectável |
| `CLAUDE_CONFIG_DIR` | Base `~/.claude` |
| `XDG_CONFIG_HOME` | OpenCode e outros (multi-agente) |
| `CODEX_HOME` | Prompts Codex em instalação multi-agente |

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional, com IDs D-NN), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md` (opcional), `.oxe/NOTES.md` (opcional, fila), `.oxe/RESUME.md` (opcional, trilha + ponte para delta), `.oxe/CODEBASE-DELTA.md` (opcional, último refresh documentado do codebase), `.oxe/CHECKPOINTS.md` (opcional, índice), `.oxe/checkpoints/*.md` (opcional, marcos de sessão), `.oxe/RESEARCH.md` (opcional, índice de pesquisa), `.oxe/research/*.md` (opcional, notas datadas), `.oxe/VALIDATION-GAPS.md` (opcional, pós-verify), `.oxe/FORENSICS.md` (opcional, recuperação), `.oxe/DEBUG.md` (opcional, sessões de debug), `.oxe/UI-SPEC.md` / `.oxe/UI-REVIEW.md` (opcional, front-end)
- **Novos artefatos:** `.oxe/MILESTONES.md` (marcos de entrega), `.oxe/milestones/M-NN/` (artefatos arquivados), `.oxe/workstreams/<nome>/` (trilhas paralelas), `.oxe/personas/*.md` (personas de agentes customizadas), `.oxe/plugins/*.cjs` (plugins de lifecycle), `.oxe/memory/*.md` (sidecars de memória por sessão), `.oxe/EXECUTION-RUNTIME.md` (runtime operacional), `.oxe/CAPABILITIES.md` + `.oxe/capabilities/` (catálogo nativo), `.oxe/INVESTIGATIONS.md` + `.oxe/investigations/` (investigações estruturadas), `.oxe/dashboard/` (camada visual opcional).
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado, conforme instalação). Hooks Git **opt-in** (lembretes não bloqueantes): `oxe/templates/GIT_HOOKS_OXE.md`. Plugin system: `oxe/templates/PLUGINS.md`.

## Para autores (mantenedores)

- Guia de autoria dos workflows: **`oxe/templates/WORKFLOW_AUTHORING.md`** (no pacote) ou **`.oxe/templates/WORKFLOW_AUTHORING.md`** após instalação em layout aninhado.
- Revisão guiada de um ficheiro de workflow contra esse guia: workflow **`workflow-authoring.md`** (mesma pasta que os outros passos).

## Gatilhos em linguagem natural

Quando o usuário disser “oxe scan”, “oxe quick”, “executar onda OXE”, “revisar PR”, “forensics”, “debug OXE”, “oxe research”, “oxe compact”, “refresh codebase”, “sincronizar mapa OXE”, “oxe resume”, “oxe checkpoint”, “mapa do sistema”, “engenharia reversa”, “modernização”, “validate gaps”, “Nyquist-lite”, “UI spec”, “roteamento OXE”, “rever um workflow OXE” / “alinhar ao guia de autoria”, etc., siga o workflow correspondente em `oxe/workflows/*.md` ou `.oxe/workflows/*.md` (autoria: `workflow-authoring.md`; meta: `route.md`).

**GitHub Copilot CLI:** com `oxe-cc --copilot-cli`, use **agent skills** em **`~/.copilot/skills/`** — invoque **`/oxe`** (entrada, mesmo conteúdo que help) ou **`/oxe-scan`**, **`/oxe-plan`**, etc. Após instalar ou atualizar: **`/skills reload`** (ou reinicie o `copilot`). A pasta **`~/.copilot/commands/`** é só cópia legado; o CLI oficial não a usa como slash commands.

**Multi-agente:** `npx oxe-cc --all-agents` (ou opção **6** no instalador) replica os mesmos fluxos para **OpenCode** (`~/.config/opencode/commands` + `~/.opencode/commands`), **Gemini CLI** (`~/.gemini/commands` — `/oxe`, `/oxe:scan`, …; use **`/commands reload`**), **Codex** (`~/.agents/skills` + `~/.codex/prompts` com `/prompts:oxe-*`), **Windsurf** (`~/.codeium/windsurf/global_workflows` — `/oxe-scan`), **Google Antigravity** (`~/.gemini/antigravity/skills`), além de **Claude** (`~/.claude/commands`) e o já descrito Copilot.
</output>

<success_criteria>
- [ ] O utilizador recebeu orientação sobre o fluxo OXE, comandos disponíveis e como invocar na IDE ativa.
- [ ] Nenhum artefato em `.oxe/` foi criado ou alterado (passo puramente informativo).
</success_criteria>
