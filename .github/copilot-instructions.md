# OXE — fluxo spec-driven (Cursor + Copilot)

Este repositório (ou o pacote **oxe-cc** instalado) define o **OXE**: artefatos em **`.oxe/`** na raiz do projeto alvo e workflows em **`oxe/workflows/*.md`** (no pacote) ou **`.oxe/workflows/*.md`** / **`oxe/workflows/*.md`** no projeto, conforme a instalação (layout mínimo vs clássico).

## Quando aplicar

Se o usuário mencionar **OXE**, **oxe**, **/oxe-**, ou pedidos como “mapear o projeto”, “criar spec OXE”, “plano OXE com testes”, “verificar OXE”, trate como fluxo OXE e siga o arquivo de workflow correspondente abaixo.

## Workflows (fonte única)

| Passo | Arquivo | Gatilhos naturais (exemplos) |
|-------|---------|-------------------------------|
| Scan | `oxe/workflows/scan.md` | “oxe scan”, “mapear o repo”, “atualizar codebase OXE” |
| Spec | `oxe/workflows/spec.md` | “oxe spec”, “escrever SPEC.md”, “requisitos OXE” |
| Discuss | `oxe/workflows/discuss.md` | “oxe discuss”, “perguntas antes do plano”, “DISCUSS.md” |
| Plan | `oxe/workflows/plan.md` | “oxe plan”, “PLAN.md”, “plano com testes por tarefa”, “replan” |
| Quick | `oxe/workflows/quick.md` | “oxe quick”, “fix rápido OXE”, “QUICK.md” |
| Execute | `oxe/workflows/execute.md` | “oxe execute”, “executar onda”, “onda 2 OXE” |
| Verify | `oxe/workflows/verify.md` | “oxe verify”, “validar plano OXE”, “VERIFY.md” |
| Next | `oxe/workflows/next.md` | “oxe next”, “próximo passo OXE” |
| Review PR | `oxe/workflows/review-pr.md` | “revisar PR”, link `…/pull/10`, “diff entre branches” *(prompt Copilot: `/oxe-review-pr`)* |
| Help | `oxe/workflows/help.md` | “oxe help”, “como usar OXE” |
| Autoria de workflow | `oxe/workflows/workflow-authoring.md` | “rever workflow OXE”, “revisar `oxe/workflows/foo.md` contra o guia”, alinhar passo ao `WORKFLOW_AUTHORING.md` |

**Regra:** leia o Markdown indicado e execute **todos** os passos e critérios de sucesso descritos nesse arquivo. Não atalhe: crie ou atualize os arquivos em `.oxe/` conforme o workflow.

**Cursor:** há slash `/oxe-*` para scan…help em `~/.cursor/commands/`; **não** há comando slash dedicado a review-pr no Cursor — use linguagem natural + `oxe/workflows/review-pr.md` em contexto.

## Onde ficam as integrações (após `npx oxe-cc`)

- **Cursor:** comandos em **`~/.cursor/commands/`** (slash `/oxe-*`). Diretório alternativo: variável **`CURSOR_CONFIG_DIR`**.
- **GitHub Copilot (VS Code):** instruções mescladas em **`~/.copilot/copilot-instructions.md`** (bloco OXE) e **prompt files** em **`~/.copilot/prompts/`** (`oxe-*.prompt.md`). **Não** espere `.github/prompts/` no repositório do projeto para o Copilot — o instalador usa **`~/.copilot/`** (`COPILOT_CONFIG_DIR` / `COPILOT_HOME` se definidos).
- **Copilot CLI:** com `oxe-cc --copilot-cli`, use **agent skills** em **`~/.copilot/skills/`** (`/oxe`, `/oxe-scan`, …). Depois de instalar: **`/skills reload`**. Pastas **`~/.claude/commands/`** e **`~/.copilot/commands/`** são cópia legado; **`CLAUDE_CONFIG_DIR`** altera o home Claude.
- **Multi-agente:** `oxe-cc --all-agents` (menu **6**) replica fluxos para **OpenCode**, **Gemini CLI** (`/commands reload`), **Codex**, **Windsurf**, **Antigravity**, além de Cursor/Copilot/Claude. **`XDG_CONFIG_HOME`** / **`CODEX_HOME`** afetam caminhos canónicos desses destinos. O núcleo no repo continua **`.oxe/`** (SPEC/PLAN/VERIFY em Markdown).

## Configuração do projeto

- **`.oxe/config.json`**: fluxo (`discuss_before_plan`, `scan_max_age_days`, `spec_required_sections`, …) e opcionalmente **`install`** (perfil e layout quando o utilizador corre o instalador **sem** flags IDE explícitas). Referência: `oxe/templates/CONFIG.md`. Para ignorar o bloco `install` numa corrida: **`--no-install-config`**.
- Sem TTY (CI): **`OXE_NO_PROMPT=1`** — padrões de layout/integração; o ficheiro `install` em `config.json` aplica-se se existir e as flags não sobrepuserem.

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*.md`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md` (opcional)
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado)

## CLI e SDK

- **`npx oxe-cc`** ou **`npx oxe-cc install`** — instalação (equivalentes).
- **`npx oxe-cc doctor`** — validação completa (Node, workflows do pacote vs projeto, JSON, coerência STATE, regras SPEC/PLAN, **avisos** não bloqueantes sobre estrutura dos `.md` de workflow quando aplicável).
- **`npx oxe-cc status`** — mais leve: coerência `.oxe/` + **um** próximo passo (não exige o mesmo rigor de workflows que o `doctor`).
- **`npx oxe-cc init-oxe`**, **`uninstall`**, **`update`** — ver `oxe-cc --help` ou README do pacote.
- **SDK (Node):** `require('oxe-cc')` expõe `runDoctorChecks`, `health`, `workflows`, `install`, `manifest`, `agents` — útil para CI (`lib/sdk/README.md`, `lib/sdk/index.d.ts`).

**WSL:** usar Node **nativo do WSL**; o `oxe-cc` recusa Node do Windows dentro do WSL (caminhos incorretos).

## Manutenção do pacote oxe-build

Ao alterar comportamento OXE, edite primeiro **`oxe/workflows/*.md`**; mantenha comandos Cursor e prompts Copilot alinhados a essa pasta.

**Autoria de workflows:** guia em **`oxe/templates/WORKFLOW_AUTHORING.md`**. Para rever um `.md` de passo contra o guia, use o workflow **`oxe/workflows/workflow-authoring.md`** (ou `.oxe/workflows/` no projeto alvo).
