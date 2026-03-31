# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → plan → execução → verify), o modo **quick**, o passo **execute**, e como invocar no **Cursor** e no **GitHub Copilot**. Mencionar o CLI `oxe-cc` (instalar, `doctor`, `status`, `init-oxe`, `uninstall`, `update`) e, em linha, o **SDK** npm (`require('oxe-cc')`) para CI.
</objective>

<context>
OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no projeto alvo. **Poucos comandos slash** em relação a fluxos de planeamento mais pesados; *context engineering* com arquivos pequenos por etapa. Instruções do Copilot no VS Code ficam em **`~/.copilot/`** após `npx oxe-cc` (bloco mesclado em `copilot-instructions.md` + **prompt files** em `~/.copilot/prompts/`), não em `.github/` dentro do repo alvo.

No **projeto**, os passos canónicos estão em **`.oxe/workflows/*.md`** (layout mínimo) ou **`oxe/workflows/*.md`** (layout clássico com `--global`); no **pacote npm**, os modelos vivem em **`oxe/workflows/*.md`**.
</context>

<output>
## Cursor

Slash commands: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, `/oxe-plan`, `/oxe-verify`, `/oxe-next`, `/oxe-quick`, `/oxe-execute`, `/oxe-help` (instalados em `~/.cursor/commands/` pelo `oxe-cc`). **Review de PR:** no Cursor não há slash dedicado — peça em linguagem natural seguindo `oxe/workflows/review-pr.md` (ou `.oxe/workflows/review-pr.md`) em contexto.

## GitHub Copilot (VS Code)

1. **Instruções do usuário:** arquivo **`~/.copilot/copilot-instructions.md`** (conteúdo mesclado pelo instalador; contém o bloco OXE entre marcadores).
2. **Prompt files:** em **`~/.copilot/prompts/`** (ex.: `oxe-scan.prompt.md`). No chat, `/` e escolha **`oxe-scan`**, **`oxe-spec`**, etc. Requer `"chat.promptFiles": true` (exemplo em `.vscode/settings.json` do repo com layout `--global`).
3. **`/oxe-review-pr`** — revisão de PR/diff (prompt na pasta do usuário; fluxo em `review-pr.md`).

## Fluxo completo

1. **scan** — após clonar ou quando o repositório mudar muito.
2. **spec** — descrever o que se quer (critérios com IDs **A1**, **A2**…).
3. **discuss** (opcional) — decisões antes do plano; recomendado se `discuss_before_plan` em `.oxe/config.json`.
4. **plan** — plano executável + **Verificar** por tarefa, ligado aos critérios da SPEC.
5. **execute** (opcional) — onda a onda com base no PLAN (ou passos do QUICK).
6. Implementar mudanças no agente/editor.
7. **verify** — validar tarefas **e** critérios SPEC antes de merge/PR.
8. **next** — retomar trabalho; no terminal: **`npx oxe-cc status`** sugere um único próximo passo (mais leve que **`doctor`**, que valida também workflows do pacote e regras estritas).

## Modo rápido (quick)

- **`/oxe-quick`**: cria `.oxe/QUICK.md` (passos curtos + verificar) sem SPEC/PLAN longos. **Promova** para spec/plan se o trabalho crescer (muitos arquivos, API pública, segurança) — ver workflow `quick.md`.

## CLI (terminal)

- **`npx oxe-cc`** ou **`npx oxe-cc install`** — mesma instalação (alias explícito).
- Instala workflows em `.oxe/` (layout mínimo) ou `oxe/` + `.oxe/` com **`--global`**; integrações em `~/.cursor`, `~/.copilot`, `~/.claude` (e mais destinos com **`--copilot-cli`** / **`--all-agents`**).
- **`oxe-cc doctor`** — Node, workflows do pacote vs projeto, `config.json`, mapas do codebase, **coerência STATE vs arquivos**, scan antigo (`scan_max_age_days`), seções SPEC, ondas do PLAN, **avisos** não bloqueantes sobre estrutura dos `.md` de workflow (ex.: `<objective>`, critérios de sucesso).
- **`oxe-cc status`** — coerência `.oxe/` + **um** próximo passo (espelha `next.md`).
- **`oxe-cc init-oxe`** — só bootstrap `.oxe/` (STATE, config, codebase).
- **`oxe-cc uninstall`** — remove integrações no HOME e, por omissão, pastas de workflows no repo (`--ide-only` só HOME).
- **`oxe-cc update` / `npx oxe-cc@latest --force`** — atualizar ficheiros OXE no projeto.

**CI / sem perguntas:** `OXE_NO_PROMPT=1` — layout mínimo e integrações padrão no HOME, salvo flags (`--global`, `--cursor`, …). Se existir **`.oxe/config.json`** com bloco **`install`** (perfil, `repo_layout`), aplica-se quando **não** há flags IDE explícitas; para ignorar: **`--no-install-config`**. Detalhes: `oxe/templates/CONFIG.md`.

**Flags úteis (resumo):** `--force` / `-f`, `--dry-run`, `--all` / `-a` (Cursor+Copilot), `--oxe-only`, `--no-init-oxe`, `--global` / `--local`, `--copilot-cli`, `--all-agents`, `--vscode` (com `--global`), `--no-global-cli` / `-l`, `--config-dir` / `-c` (uma IDE de cada vez), `--dir <pasta>`. Ajuda completa: `oxe-cc --help`.

**WSL:** usar Node instalado **no** WSL; o instalador recusa Node do Windows dentro do WSL.

## SDK (API programática)

Quem integra em pipeline pode usar **`require('oxe-cc')`** (entrada `main` do pacote): por exemplo **`runDoctorChecks({ projectRoot })`** para passo de gate em CI; também `health`, `workflows`, `install.resolveOptionsFromConfig`, `manifest`, `agents`. Ver **`lib/sdk/README.md`** e **`lib/sdk/index.d.ts`**.

## Variáveis de ambiente (referência)

| Variável | Uso |
|----------|-----|
| `OXE_NO_PROMPT` | `1` / `true`: sem menus interativos |
| `OXE_NO_BANNER` | `1` / `true`: sem banner no CLI |
| `CURSOR_CONFIG_DIR` | Base Cursor (default `~/.cursor`) |
| `COPILOT_CONFIG_DIR` / `COPILOT_HOME` | Base Copilot |
| `CLAUDE_CONFIG_DIR` | Base `~/.claude` |
| `XDG_CONFIG_HOME` | OpenCode e outros (multi-agente) |
| `CODEX_HOME` | Prompts Codex em instalação multi-agente |

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md` (opcional)
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado, conforme instalação)

## Para autores (mantenedores)

- Guia de autoria dos workflows: **`oxe/templates/WORKFLOW_AUTHORING.md`** (no pacote) ou **`.oxe/templates/WORKFLOW_AUTHORING.md`** após instalação em layout aninhado.
- Revisão guiada de um ficheiro de workflow contra esse guia: workflow **`workflow-authoring.md`** (mesma pasta que os outros passos).

## Gatilhos em linguagem natural

Quando o usuário disser “oxe scan”, “oxe quick”, “executar onda OXE”, “revisar PR”, “rever um workflow OXE” / “alinhar ao guia de autoria”, etc., siga o workflow correspondente em `oxe/workflows/*.md` ou `.oxe/workflows/*.md` (autoria: `workflow-authoring.md`).

**GitHub Copilot CLI:** com `oxe-cc --copilot-cli`, use **agent skills** em **`~/.copilot/skills/`** — invoque **`/oxe`** (entrada, mesmo conteúdo que help) ou **`/oxe-scan`**, **`/oxe-plan`**, etc. Após instalar ou atualizar: **`/skills reload`** (ou reinicie o `copilot`). A pasta **`~/.copilot/commands/`** é só cópia legado; o CLI oficial não a usa como slash commands.

**Multi-agente:** `npx oxe-cc --all-agents` (ou opção **6** no instalador) replica os mesmos fluxos para **OpenCode** (`~/.config/opencode/commands` + `~/.opencode/commands`), **Gemini CLI** (`~/.gemini/commands` — `/oxe`, `/oxe:scan`, …; use **`/commands reload`**), **Codex** (`~/.agents/skills` + `~/.codex/prompts` com `/prompts:oxe-*`), **Windsurf** (`~/.codeium/windsurf/global_workflows` — `/oxe-scan`), **Google Antigravity** (`~/.gemini/antigravity/skills`), além de **Claude** (`~/.claude/commands`) e o já descrito Copilot.
</output>
