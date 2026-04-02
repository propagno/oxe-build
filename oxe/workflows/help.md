# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → plan → execução → verify), o modo **quick**, o passo **execute**, e **como invocar em várias IDEs/CLIs** (Cursor e GitHub Copilot como referência principal; outras stacks na secção multi-agente). Mencionar o CLI `oxe-cc` (instalar, `doctor`, `status`, `init-oxe`, `uninstall`, `update`) e, em linha, o **SDK** npm (`require('oxe-cc')`) para CI.
</objective>

<context>
OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no projeto alvo — **o núcleo é o mesmo** em Cursor, Copilot, Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity ou outra CLI suportada pelo instalador. **Poucos comandos** por ferramenta em relação a fluxos de planeamento mais pesados; *context engineering* com arquivos pequenos por etapa. **GitHub Copilot (VS Code)** usa **`~/.copilot/`** após `npx oxe-cc` (bloco mesclado em `copilot-instructions.md` + **prompt files** em `~/.copilot/prompts/`), não `.github/` dentro do repo alvo por padrão; outras ferramentas usam os respetivos homes (ver secção **Multi-agente** abaixo).

No **projeto**, os passos canónicos estão em **`.oxe/workflows/*.md`** (layout mínimo) ou **`oxe/workflows/*.md`** (layout clássico com `--global`); no **pacote npm**, os modelos vivem em **`oxe/workflows/*.md`**.
</context>

<output>
## Integrações principais (referência)

### Cursor

Slash commands: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, `/oxe-plan`, `/oxe-verify`, `/oxe-next`, `/oxe-quick`, `/oxe-execute`, `/oxe-update`, `/oxe-help`, `/oxe-forensics`, `/oxe-debug`, `/oxe-route`, `/oxe-ui-spec`, `/oxe-ui-review` (instalados em `~/.cursor/commands/` pelo `oxe-cc` após `npm run sync:cursor` no pacote ou cópia equivalente). **Review de PR:** no Cursor não há slash dedicado — peça em linguagem natural seguindo `oxe/workflows/review-pr.md` (ou `.oxe/workflows/review-pr.md`) em contexto.

### GitHub Copilot (VS Code)

1. **Instruções do usuário:** arquivo **`~/.copilot/copilot-instructions.md`** (conteúdo mesclado pelo instalador; contém o bloco OXE entre marcadores).
2. **Prompt files:** em **`~/.copilot/prompts/`** (ex.: `oxe-scan.prompt.md`). No chat, `/` e escolha **`oxe-scan`**, **`oxe-spec`**, etc. Requer `"chat.promptFiles": true` (exemplo em `.vscode/settings.json` do repo com layout `--global`).
3. **`/oxe-review-pr`** — revisão de PR/diff (prompt na pasta do usuário; fluxo em `review-pr.md`).

## Fluxo completo

1. **scan** — após clonar ou quando o repositório mudar muito. Repositórios **legado** (COBOL, JCL, copybooks, VB6, SQL procedures): o passo **scan** aplica `oxe/workflows/references/legacy-brownfield.md` quando esses sinais existirem — preencha `TESTING.md` com honestidade (sem `npm test` fictício) e use `scan_focus_globs` em `.oxe/config.json` (ver `oxe/templates/CONFIG.md`).
2. **spec** — descrever o que se quer (critérios com IDs **A1**, **A2**…).
3. **discuss** (opcional) — decisões antes do plano; recomendado se `discuss_before_plan` em `.oxe/config.json`.
4. **plan** — plano executável + **Verificar** por tarefa, ligado aos critérios da SPEC.
5. **execute** (opcional) — onda a onda com base no PLAN (ou passos do QUICK).
6. Implementar mudanças no agente/editor.
7. **verify** — validar tarefas **e** critérios SPEC antes de merge/PR.
8. **next** — retomar trabalho; no terminal: **`npx oxe-cc status`** sugere um único próximo passo (mais leve que **`doctor`**, que valida também workflows do pacote e regras estritas).

**Recuperação e meta (mesma trilha, outra camada):**

- **`/oxe-forensics`** — após `verify` falhar, `doctor` em falta ou estado incoerente; escreve `.oxe/FORENSICS.md` e recomenda **um** reingresso: `scan`, `plan` ou `execute` (ver `forensics.md`).
- **`/oxe-debug`** — durante **`execute`**, para sintomas técnicos (teste vermelho, stack); escreve `.oxe/DEBUG.md`; **não** substitui `verify` após corrigir (ver `debug.md`).
- **`/oxe-route`** — desambigua pedido em linguagem natural → **um** workflow/comando; não gera SPEC/PLAN (ver `route.md` e tabela **Router** abaixo).

**Vertical UI (opcional, mesma trilha):**

- **`/oxe-ui-spec`** — após **spec**, contrato `.oxe/UI-SPEC.md` antes ou para alimentar o **plan** (ver `ui-spec.md`).
- **`/oxe-ui-review`** — após implementação UI, auditoria `.oxe/UI-REVIEW.md` antes ou como entrada para **verify** (ver `ui-review.md`).

## Modo rápido (quick)

- **`/oxe-quick`**: cria `.oxe/QUICK.md` (passos curtos + verificar) sem SPEC/PLAN longos. **Perfil fast:** objetivo numa frase, ≤10 passos — ver secção **Perfil fast** em `quick.md`. **Promova** para spec/plan se o trabalho crescer (muitos arquivos, API pública, segurança) — mesmos gatilhos no workflow.

## CLI (terminal)

- **`npx oxe-cc`** ou **`npx oxe-cc install`** — mesma instalação (alias explícito).
- Instala workflows em `.oxe/` (layout mínimo) ou `oxe/` + `.oxe/` com **`--global`**; integrações em `~/.cursor`, `~/.copilot`, `~/.claude` (e mais destinos com **`--copilot-cli`** / **`--all-agents`**).
- **`oxe-cc doctor`** — Node, workflows do pacote vs projeto, `config.json`, mapas do codebase, **coerência STATE vs arquivos**, scan antigo (`scan_max_age_days`), seções SPEC, ondas do PLAN, **avisos** não bloqueantes sobre estrutura dos `.md` de workflow (ex.: `<objective>`, critérios de sucesso).
- **`oxe-cc status`** — coerência `.oxe/` + **um** próximo passo (espelha `next.md`). Com **`--json`**, uma linha JSON (`nextStep`, `diagnostics`, …) para CI ou scripts.
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

## Notas pré-trilha (opcional)

- Ficheiro **`.oxe/NOTES.md`**: bullets `YYYY-MM-DD — …` como fila leve (**não** substitui SPEC). Em **`/oxe-discuss`** e **`/oxe-plan`**, consumir ou marcar descartado/adiado.

## SDK (API programática)

Quem integra em pipeline pode usar **`require('oxe-cc')`** (entrada `main` do pacote): por exemplo **`runDoctorChecks({ projectRoot })`** para passo de gate em CI; também `health`, `workflows`, `install.resolveOptionsFromConfig`, `manifest`, `agents`. Ver **`lib/sdk/README.md`** e **`lib/sdk/index.d.ts`**.

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

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md` (opcional), `.oxe/NOTES.md` (opcional, fila), `.oxe/FORENSICS.md` (opcional, recuperação), `.oxe/DEBUG.md` (opcional, sessões de debug), `.oxe/UI-SPEC.md` / `.oxe/UI-REVIEW.md` (opcional, front-end)
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado, conforme instalação)

## Para autores (mantenedores)

- Guia de autoria dos workflows: **`oxe/templates/WORKFLOW_AUTHORING.md`** (no pacote) ou **`.oxe/templates/WORKFLOW_AUTHORING.md`** após instalação em layout aninhado.
- Revisão guiada de um ficheiro de workflow contra esse guia: workflow **`workflow-authoring.md`** (mesma pasta que os outros passos).

## Gatilhos em linguagem natural

Quando o usuário disser “oxe scan”, “oxe quick”, “executar onda OXE”, “revisar PR”, “forensics”, “debug OXE”, “UI spec”, “roteamento OXE”, “rever um workflow OXE” / “alinhar ao guia de autoria”, etc., siga o workflow correspondente em `oxe/workflows/*.md` ou `.oxe/workflows/*.md` (autoria: `workflow-authoring.md`; meta: `route.md`).

**GitHub Copilot CLI:** com `oxe-cc --copilot-cli`, use **agent skills** em **`~/.copilot/skills/`** — invoque **`/oxe`** (entrada, mesmo conteúdo que help) ou **`/oxe-scan`**, **`/oxe-plan`**, etc. Após instalar ou atualizar: **`/skills reload`** (ou reinicie o `copilot`). A pasta **`~/.copilot/commands/`** é só cópia legado; o CLI oficial não a usa como slash commands.

**Multi-agente:** `npx oxe-cc --all-agents` (ou opção **6** no instalador) replica os mesmos fluxos para **OpenCode** (`~/.config/opencode/commands` + `~/.opencode/commands`), **Gemini CLI** (`~/.gemini/commands` — `/oxe`, `/oxe:scan`, …; use **`/commands reload`**), **Codex** (`~/.agents/skills` + `~/.codex/prompts` com `/prompts:oxe-*`), **Windsurf** (`~/.codeium/windsurf/global_workflows` — `/oxe-scan`), **Google Antigravity** (`~/.gemini/antigravity/skills`), além de **Claude** (`~/.claude/commands`) e o já descrito Copilot.
</output>
