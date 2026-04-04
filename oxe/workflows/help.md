# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → research opcional → plan → execução → verify → validate-gaps opcional), o modo **quick**, o passo **execute**, e **como invocar em várias IDEs/CLIs** (Cursor e GitHub Copilot como referência principal; outras stacks na secção multi-agente). Mencionar o CLI `oxe-cc` (instalar, `doctor`, `status`, `init-oxe`, `uninstall`, `update`) e, em linha, o **SDK** npm (`require('oxe-cc')`) para CI.
</objective>

<context>
OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no projeto alvo — **o núcleo é o mesmo** em Cursor, Copilot, Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity ou outra CLI suportada pelo instalador. **Poucos comandos** por ferramenta em relação a fluxos de planeamento mais pesados; *context engineering* com arquivos pequenos por etapa. **GitHub Copilot (VS Code)** usa **`~/.copilot/`** após `npx oxe-cc` (bloco mesclado em `copilot-instructions.md` + **prompt files** em `~/.copilot/prompts/`), não `.github/` dentro do repo alvo por padrão; outras ferramentas usam os respetivos homes (ver secção **Multi-agente** abaixo).

No **projeto**, os passos canónicos estão em **`.oxe/workflows/*.md`** (layout mínimo) ou **`oxe/workflows/*.md`** (layout clássico com `--global`); no **pacote npm**, os modelos vivem em **`oxe/workflows/*.md`**.
</context>

<output>
## Integrações principais (referência)

### Cursor

Slash commands: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, `/oxe-plan`, `/oxe-plan-agent`, `/oxe-verify`, `/oxe-next`, `/oxe-quick`, `/oxe-execute`, `/oxe-obs`, `/oxe-update`, `/oxe-help`, `/oxe-forensics`, `/oxe-debug`, `/oxe-route`, `/oxe-research`, `/oxe-validate-gaps`, `/oxe-compact`, `/oxe-checkpoint`, `/oxe-ui-spec`, `/oxe-ui-review`, `/oxe-milestone`, `/oxe-workstream` (instalados em `~/.cursor/commands/` pelo `oxe-cc` após `npm run sync:cursor` no pacote ou cópia equivalente). **Review de PR:** no Cursor não há slash dedicado — peça em linguagem natural seguindo `oxe/workflows/review-pr.md` (ou `.oxe/workflows/review-pr.md`) em contexto.

### GitHub Copilot (VS Code)

1. **Instruções do usuário:** arquivo **`~/.copilot/copilot-instructions.md`** (conteúdo mesclado pelo instalador; contém o bloco OXE entre marcadores).
2. **Prompt files:** em **`~/.copilot/prompts/`** (ex.: `oxe-scan.prompt.md`). No chat, `/` e escolha **`oxe-scan`**, **`oxe-spec`**, etc. Requer `"chat.promptFiles": true` (exemplo em `.vscode/settings.json` do repo com layout `--global`).
3. **`/oxe-review-pr`** — revisão de PR/diff (prompt na pasta do usuário; fluxo em `review-pr.md`).

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

0. **obs** *(qualquer momento)* — `/oxe-obs` registra uma observação contextual em `.oxe/OBSERVATIONS.md`; incorporada automaticamente no próximo spec/plan/execute sem re-explicar (ver seção **Observações** abaixo).
1. **scan** — após clonar ou quando o repositório mudar muito. Repositórios **legado** (COBOL, JCL, copybooks, VB6, SQL procedures): o passo **scan** aplica `oxe/workflows/references/legacy-brownfield.md` quando esses sinais existirem — preencha `TESTING.md` com honestidade (sem `npm test` fictício) e use `scan_focus_globs` em `.oxe/config.json` (ver `oxe/templates/CONFIG.md`).
2. **spec** — fluxo em **5 fases**: perguntas (máx 3 rodadas) → pesquisa (opcional) → requisitos R-ID (v1/v2/fora) → roteiro (`.oxe/ROADMAP.md`) → aprovação → instrui plan ou plan-agent.
2b. **research** (opcional, pode ser proposto pela Fase 2 do spec) — notas datadas em `.oxe/research/` + índice `.oxe/RESEARCH.md`; spikes, mapa de sistema, engenharia reversa, modernização.
3. **discuss** (opcional) — decisões com IDs D-NN antes do plano; recomendado se `discuss_before_plan` em `.oxe/config.json`. Incorpora OBS pendentes de impacto spec/plan.
4. **plan** — plano executável + **Verificar** por tarefa, ligado aos critérios A* da SPEC. Incorpora OBS pendentes de impacto plan.
4b. **plan-agent** (opcional) — igual ao **plan** + **`.oxe/plan-agents.json`** (schema **2**: `runId` **novo** por demanda, `lifecycle`). Agentes criados especificamente para ESTE plano — sem reuso entre demandas. `/oxe-quick` invalida o blueprint.
5. **execute** — seleção de modo ao iniciar: **A) Completo** (1 sessão/requisição), **B) Por onda** (N sessões), **C) Por tarefa** (controle máximo). Incorpora OBS pendentes de impacto execute.
6. Implementar mudanças no agente/editor.
7. **verify** — 4 camadas: auditoria pré-exec, tarefas + critérios A*, fidelidade D-NN, UAT checklist.
7b. **validate-gaps** (opcional) — após verify, auditoria de cobertura em `.oxe/VALIDATION-GAPS.md`.
8. **next** — retomar trabalho; no terminal: **`npx oxe-cc status`** sugere um único próximo passo.

**Recuperação e meta (mesma trilha, outra camada):**

- **`/oxe-forensics`** — após `verify` falhar, `doctor` em falta ou estado incoerente; escreve `.oxe/FORENSICS.md` e recomenda **um** reingresso: `scan`, `plan` ou `execute` (ver `forensics.md`).
- **`/oxe-debug`** — durante **`execute`**, para sintomas técnicos (teste vermelho, stack); escreve `.oxe/DEBUG.md`; **não** substitui `verify` após corrigir (ver `debug.md`).
- **`/oxe-route`** — desambigua pedido em linguagem natural → **um** workflow/comando; não gera SPEC/PLAN (ver `route.md` e tabela **Router** abaixo).

**Contexto em disco (opcional):**

- **`/oxe-compact`** — **refresh do projeto**: compara **`.oxe/codebase/*.md`** ao repositório atual, **atualiza** os sete mapas (incremental ou bootstrap como `scan.md` se faltar base), escreve **`.oxe/CODEBASE-DELTA.md`** (o que mudou na documentação) e **`.oxe/RESUME.md`** (trilha OXE + ponte para o delta). Rotina de desenvolvimento; **não** está ligado a limites de chat ou a ferramentas específicas (ver `compact.md`). *Exemplo:* scan mapeou **Angular 17**; após migração implementada para **21**, o compact **corrige** `STACK.md`/testes/convenções face ao repo — intenção: **documentação OXE = código atual**, não refazer scan completo só por bump de major.
- **`/oxe-checkpoint`** — **snapshot de sessão**: **`.oxe/checkpoints/…md`** + **`.oxe/CHECKPOINTS.md`**; marco nomeado sem apagar SPEC/PLAN (ver `checkpoint.md`).

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
- Instala workflows em `.oxe/` (layout mínimo) ou `oxe/` + `.oxe/` com **`--global`**; integrações em `~/.cursor`, `~/.copilot`, `~/.claude` (e mais destinos com **`--copilot-cli`** / **`--all-agents`**).
- **`oxe-cc doctor`** — Node, workflows do pacote vs projeto, `config.json`, mapas do codebase, **coerência STATE vs arquivos**, scan antigo (`scan_max_age_days`), compact antigo (`compact_max_age_days`), seções SPEC, ondas do PLAN, **avisos** não bloqueantes sobre estrutura dos `.md` de workflow (ex.: `<objective>`, critérios de sucesso).
- **`oxe-cc status`** — coerência `.oxe/` + **um** próximo passo (espelha `next.md`). Com **`--json`**, uma linha JSON com **`oxeStatusSchema: 2`**, `nextStep`, `cursorCmd`, `reason`, `artifacts`, `phase`, `scanDate`, `staleScan`, `compactDate`, `staleCompact`, `diagnostics` (e com **`--json --hints`** também o array **`hints`**). Com **`--hints`** em modo texto, bloco **Lembretes (rotina OXE)** (scan/compact antigos quando `scan_max_age_days` / `compact_max_age_days` estão ativos em `config.json`).
- **`oxe-cc init-oxe`** — só bootstrap `.oxe/` (STATE, config, codebase).
- **`oxe-cc uninstall`** — remove integrações no HOME e, por omissão, pastas de workflows no repo (`--ide-only` só HOME).
- **`/oxe-update`** (Cursor; noutras ferramentas use o terminal no projeto) — workflow de atualização: verificar npm, correr `oxe-cc update`, `doctor`.
- **`oxe-cc update --check`** — só comparar versão em execução com a `latest` no npm (sem instalar).
- **`oxe-cc update --if-newer`** — só executa o `npx oxe-cc@latest` se houver versão mais nova no npm.
- **`oxe-cc update` / `npx oxe-cc@latest --force`** — atualizar ficheiros OXE no projeto.

**CI / sem perguntas:** `OXE_NO_PROMPT=1` — layout mínimo e integrações padrão no HOME, salvo flags (`--global`, `--cursor`, …). Se existir **`.oxe/config.json`** com bloco **`install`** (perfil, `repo_layout`), aplica-se quando **não** há flags IDE explícitas; para ignorar: **`--no-install-config`**. Detalhes: `oxe/templates/CONFIG.md`.

**Flags úteis (resumo):** `--force` / `-f`, `--dry-run`, `--all` / `-a` (Cursor+Copilot), `--oxe-only`, `--no-init-oxe`, `--global` / `--local`, `--copilot-cli`, `--all-agents`, `--vscode` (com `--global`), `--no-global-cli` / `-l`, `--config-dir` / `-c` (uma IDE de cada vez), `--dir <pasta>`. Ajuda completa: `oxe-cc --help`.

**WSL:** usar Node instalado **no** WSL; o instalador recusa Node do Windows dentro do WSL.

## Router (linguagem natural)

Um pedido → **um** destino (sem gerar contrato). O agente aplica `route.md` ou usa esta tabela:

| Se o utilizador disser (exemplos) | Comando / ação |
|-----------------------------------|----------------|
| Não sei que passo OXE sou / “o que faço agora?” | `/oxe-next` ou `npx oxe-cc status` |
| Acabei de clonar / falta OXE no projeto | `npx oxe-cc@latest` (ou `oxe-cc`) na raiz do repo |
| Verify falhou várias vezes / doctor estranho / artefatos incoerentes | `/oxe-forensics` |
| Teste ou erro técnico durante o trabalho (stack, flake) | `/oxe-debug` (com **Tn** se houver) |
| Revisar diff / PR antes do merge | `oxe/workflows/review-pr.md` em contexto *(Copilot: `/oxe-review-pr`)* |
| O que é OXE / lista de passos | `/oxe-help` |
| Dúvida entre dois comandos sem contexto claro | `/oxe-route` |
| Pesquisa técnica, spike, mapa de sistema grande, engenharia reversa, modernização antes do plano | `/oxe-research` |
| Quero registrar uma observação (restrição, descoberta, preferência) durante ou fora de execução | `/oxe-obs [texto]` |
| Quero executar todo o plano de uma vez (1 sessão) | `/oxe-execute` → escolher opção A (Completo) |
| Quero executar onda por onda com verificação entre ondas | `/oxe-execute` → escolher opção B (Por onda) |
| Gaps de cobertura de verificação / Nyquist-lite após verify | `/oxe-validate-gaps` |
| Mapa OXE desatualizado / quero sincronizar codebase com o código sem scan completo | `/oxe-compact` |
| Quero gravar um marco nomeado da sessão (antes de experimento grande) | `/oxe-checkpoint` + slug |
| Plano com **blueprint de agentes** (JSON + mesmo PLAN.md) / subagentes por onda | `/oxe-plan-agent` |
| Criar marco de entrega / versão / milestone | `/oxe-milestone new [nome]` |
| Verificar se o milestone está pronto para fechar | `/oxe-milestone audit` |
| Trabalho paralelo em trilhas separadas / feature branch OXE | `/oxe-workstream new <nome>` |
| Alternar entre trilhas de desenvolvimento | `/oxe-workstream switch <nome>` |

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
| `COPILOT_CONFIG_DIR` / `COPILOT_HOME` | Base Copilot |
| `CLAUDE_CONFIG_DIR` | Base `~/.claude` |
| `XDG_CONFIG_HOME` | OpenCode e outros (multi-agente) |
| `CODEX_HOME` | Prompts Codex em instalação multi-agente |

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional, com IDs D-NN), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md` (opcional), `.oxe/NOTES.md` (opcional, fila), `.oxe/RESUME.md` (opcional, trilha + ponte para delta), `.oxe/CODEBASE-DELTA.md` (opcional, último refresh documentado do codebase), `.oxe/CHECKPOINTS.md` (opcional, índice), `.oxe/checkpoints/*.md` (opcional, marcos de sessão), `.oxe/RESEARCH.md` (opcional, índice de pesquisa), `.oxe/research/*.md` (opcional, notas datadas), `.oxe/VALIDATION-GAPS.md` (opcional, pós-verify), `.oxe/FORENSICS.md` (opcional, recuperação), `.oxe/DEBUG.md` (opcional, sessões de debug), `.oxe/UI-SPEC.md` / `.oxe/UI-REVIEW.md` (opcional, front-end)
- **Novos artefatos:** `.oxe/MILESTONES.md` (marcos de entrega), `.oxe/milestones/M-NN/` (artefatos arquivados), `.oxe/workstreams/<nome>/` (trilhas paralelas), `.oxe/personas/*.md` (personas de agentes customizadas), `.oxe/plugins/*.cjs` (plugins de lifecycle), `.oxe/memory/*.md` (sidecars de memória por sessão).
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado, conforme instalação). Hooks Git **opt-in** (lembretes não bloqueantes): `oxe/templates/GIT_HOOKS_OXE.md`. Plugin system: `oxe/templates/PLUGINS.md`.

## Para autores (mantenedores)

- Guia de autoria dos workflows: **`oxe/templates/WORKFLOW_AUTHORING.md`** (no pacote) ou **`.oxe/templates/WORKFLOW_AUTHORING.md`** após instalação em layout aninhado.
- Revisão guiada de um ficheiro de workflow contra esse guia: workflow **`workflow-authoring.md`** (mesma pasta que os outros passos).

## Gatilhos em linguagem natural

Quando o usuário disser “oxe scan”, “oxe quick”, “executar onda OXE”, “revisar PR”, “forensics”, “debug OXE”, “oxe research”, “oxe compact”, “refresh codebase”, “sincronizar mapa OXE”, “oxe resume”, “oxe checkpoint”, “mapa do sistema”, “engenharia reversa”, “modernização”, “validate gaps”, “Nyquist-lite”, “UI spec”, “roteamento OXE”, “rever um workflow OXE” / “alinhar ao guia de autoria”, etc., siga o workflow correspondente em `oxe/workflows/*.md` ou `.oxe/workflows/*.md` (autoria: `workflow-authoring.md`; meta: `route.md`).

**GitHub Copilot CLI:** com `oxe-cc --copilot-cli`, use **agent skills** em **`~/.copilot/skills/`** — invoque **`/oxe`** (entrada, mesmo conteúdo que help) ou **`/oxe-scan`**, **`/oxe-plan`**, etc. Após instalar ou atualizar: **`/skills reload`** (ou reinicie o `copilot`). A pasta **`~/.copilot/commands/`** é só cópia legado; o CLI oficial não a usa como slash commands.

**Multi-agente:** `npx oxe-cc --all-agents` (ou opção **6** no instalador) replica os mesmos fluxos para **OpenCode** (`~/.config/opencode/commands` + `~/.opencode/commands`), **Gemini CLI** (`~/.gemini/commands` — `/oxe`, `/oxe:scan`, …; use **`/commands reload`**), **Codex** (`~/.agents/skills` + `~/.codex/prompts` com `/prompts:oxe-*`), **Windsurf** (`~/.codeium/windsurf/global_workflows` — `/oxe-scan`), **Google Antigravity** (`~/.gemini/antigravity/skills`), além de **Claude** (`~/.claude/commands`) e o já descrito Copilot.
</output>
