# OXE — fluxo spec-driven (multi-IDE / multi-CLI)

Este repositório (ou o pacote **oxe-cc** instalado) define o **OXE**: artefatos em **`.oxe/`** na raiz do projeto alvo e workflows em **`oxe/workflows/*.md`** (no pacote) ou **`.oxe/workflows/*.md`** / **`oxe/workflows/*.md`** no projeto, conforme a instalação (layout mínimo vs clássico). O fluxo é **agnóstico de ferramenta**; **Cursor** e **GitHub Copilot** são o caminho padrão mais conhecido, mas o mesmo OXE pode ser instalado em **Claude Code, OpenCode, Gemini CLI, Codex, Windsurf, Antigravity** e outras integrações via `oxe-cc --all-agents` (ou flags por runtime).

## Quando aplicar

Se o usuário mencionar **OXE**, **oxe**, **/oxe-**, ou pedidos como “mapear o projeto”, “criar spec OXE”, “plano OXE com testes”, “verificar OXE”, trate como fluxo OXE e siga o arquivo de workflow correspondente abaixo.

## Workflows (fonte única)

| Passo | Arquivo | Gatilhos naturais (exemplos) |
|-------|---------|-------------------------------|
| Scan | `oxe/workflows/scan.md` | “oxe scan”, “mapear o repo”, “atualizar codebase OXE” |
| Spec | `oxe/workflows/spec.md` | “oxe spec”, “escrever SPEC.md”, “requisitos OXE” |
| Discuss | `oxe/workflows/discuss.md` | “oxe discuss”, “perguntas antes do plano”, “DISCUSS.md” |
| Plan | `oxe/workflows/plan.md` | “oxe plan”, “PLAN.md”, “plano com testes por tarefa”, “replan” |
| Plan (agentes) | `oxe/workflows/plan-agent.md` | “plan agent”, “plan-agents.json”, “subagentes”, “ondas por agente”, blueprint de execução *(prompt: `/oxe-plan-agent`)* |
| Quick | `oxe/workflows/quick.md` | “oxe quick”, “fix rápido OXE”, “QUICK.md” |
| Execute | `oxe/workflows/execute.md` | “oxe execute”, “executar onda”, “onda 2 OXE” |
| Verify | `oxe/workflows/verify.md` | “oxe verify”, “validar plano OXE”, “VERIFY.md” |
| Validate gaps | `oxe/workflows/validate-gaps.md` | “validate gaps”, “Nyquist-lite”, “cobertura de critérios” após verify *(prompt: `/oxe-validate-gaps`)* |
| Next | `oxe/workflows/next.md` | “oxe next”, “próximo passo OXE” |
| Review PR | `oxe/workflows/review-pr.md` | “revisar PR”, link `…/pull/10`, “diff entre branches” *(prompt Copilot: `/oxe-review-pr`)* |
| Help | `oxe/workflows/help.md` | “oxe help”, “como usar OXE” |
| Update | `oxe/workflows/update.md` | “oxe update”, “atualizar oxe-cc”, “há versão nova no npm” *(prompt: `/oxe-update`)* |
| Forensics | `oxe/workflows/forensics.md` | “oxe forensics”, “preso após verify”, “doctor falhou”, incoerência STATE/VERIFY *(prompt: `/oxe-forensics`)* |
| Debug | `oxe/workflows/debug.md` | “oxe debug”, teste vermelho, stack trace durante implementação *(prompt: `/oxe-debug`)* |
| Route | `oxe/workflows/route.md` | “que comando OXE uso”, desambiguar intenção *(prompt: `/oxe-route`)* |
| Research | `oxe/workflows/research.md` | “oxe research”, mapa de sistema, spike, engenharia reversa, modernização *(prompt: `/oxe-research`)* |
| Compact | `oxe/workflows/compact.md` | “oxe compact”, refresh `.oxe/codebase/` vs repo + `CODEBASE-DELTA.md` + `RESUME.md` *(prompt: `/oxe-compact`)* |
| Checkpoint | `oxe/workflows/checkpoint.md` | “oxe checkpoint”, snapshot de sessão `.oxe/checkpoints/` *(prompt: `/oxe-checkpoint`)* |
| UI spec | `oxe/workflows/ui-spec.md` | “UI-SPEC”, contrato de interface após spec *(prompt: `/oxe-ui-spec`)* |
| UI review | `oxe/workflows/ui-review.md` | “auditoria UI”, UI-REVIEW *(prompt: `/oxe-ui-review`)* |
| Autoria de workflow | `oxe/workflows/workflow-authoring.md` | “rever workflow OXE”, “revisar `oxe/workflows/foo.md` contra o guia”, alinhar passo ao `WORKFLOW_AUTHORING.md` |
| Ask | `oxe/workflows/ask.md` | “oxe ask”, “situação atual OXE”, “o que está acontecendo”, “ler STATE” *(prompt: `/oxe-ask`)* |
| Obs | `oxe/workflows/obs.md` | “oxe obs”, “registrar observação”, “anotar descoberta”, “restrição encontrada” *(prompt: `/oxe-obs`)* |
| Session | `oxe/workflows/session.md` | “oxe session”, “nova sessão”, “alternar sessão”, “retomar sessão”, “fechar sessão” *(prompt: `/oxe-session`)* |
| Retro | `oxe/workflows/retro.md` | “oxe retro”, “retrospectiva”, “lições do ciclo”, “LESSONS.md” *(prompt: `/oxe-retro`)* |
| Dashboard | `oxe/workflows/dashboard.md` | “oxe dashboard”, “visualizar runtime”, “ondas ativas”, “status visual” *(prompt: `/oxe-dashboard`)* |
| Loop | `oxe/workflows/loop.md` | “oxe loop”, “iterar até passar”, “loop de verify” *(prompt: `/oxe-loop`)* |
| Security | `oxe/workflows/security.md` | “oxe security”, “auditoria OWASP”, “P0/P1 de segurança” *(prompt: `/oxe-security`)* |
| Milestone | `oxe/workflows/milestone.md` | “oxe milestone”, “marco de entrega”, “M-01”, “fechar milestone” *(prompt: `/oxe-milestone`)* |
| Workstream | `oxe/workflows/workstream.md` | “oxe workstream”, “trilha paralela”, “alternar workstream” *(prompt: `/oxe-workstream`)* |
| Capabilities | `oxe/workflows/capabilities.md` | “oxe capabilities”, “listar capabilities”, “instalar capability” *(prompt: `/oxe-capabilities`)* |
| Project | `oxe/workflows/project.md` | “oxe project”, “gestão de projeto OXE”, “milestone + workstream + checkpoint” *(prompt: `/oxe-project`)* |
| Router | `oxe/workflows/oxe.md` | “oxe”, “que comando usar”, entrada universal *(prompt: `/oxe`)* |

**Regra:** leia o Markdown indicado e execute **todos** os passos e critérios de sucesso descritos nesse arquivo. Não atalhe: crie ou atualize os arquivos em `.oxe/` conforme o workflow.

**Cursor / Copilot / Claude:** slash `/oxe-*` disponíveis: `/oxe`, `/oxe-ask`, `/oxe-obs`, `/oxe-quick`, `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, `/oxe-plan`, `/oxe-plan-agent`, `/oxe-execute`, `/oxe-verify`, `/oxe-validate-gaps`, `/oxe-retro`, `/oxe-session`, `/oxe-milestone`, `/oxe-workstream`, `/oxe-project`, `/oxe-checkpoint`, `/oxe-dashboard`, `/oxe-loop`, `/oxe-security`, `/oxe-capabilities`, `/oxe-next`, `/oxe-update`, `/oxe-forensics`, `/oxe-debug`, `/oxe-route`, `/oxe-research`, `/oxe-compact`, `/oxe-ui-spec`, `/oxe-ui-review` — em `~/.cursor/commands/` (gerados de `.github/prompts/` via `npm run sync:cursor`). **Não** há comando slash dedicado a review-pr — use linguagem natural + `oxe/workflows/review-pr.md` em contexto.

## Onde ficam as integrações (após `npx oxe-cc`)

- **Cursor:** comandos em **`~/.cursor/commands/`** (slash `/oxe-*`). Diretório alternativo: variável **`CURSOR_CONFIG_DIR`**.
- **GitHub Copilot (VS Code):** instruções mescladas em **`~/.copilot/copilot-instructions.md`** (bloco OXE) e **prompt files** em **`~/.copilot/prompts/`** (`oxe-*.prompt.md`). **Não** espere `.github/prompts/` no repositório do projeto para o Copilot — o instalador usa **`~/.copilot/`** (`COPILOT_CONFIG_DIR` / `COPILOT_HOME` se definidos).
- **Copilot CLI:** com `oxe-cc --copilot-cli`, use **agent skills** em **`~/.copilot/skills/`** (`/oxe`, `/oxe-scan`, …). Depois de instalar: **`/skills reload`**. Pastas **`~/.claude/commands/`** e **`~/.copilot/commands/`** são cópia legado; **`CLAUDE_CONFIG_DIR`** altera o home Claude.
- **Multi-agente:** `oxe-cc --all-agents` (menu **6**) replica fluxos para **OpenCode**, **Gemini CLI** (`/commands reload`), **Codex**, **Windsurf**, **Antigravity**, além de Cursor/Copilot/Claude. **`XDG_CONFIG_HOME`** / **`CODEX_HOME`** afetam caminhos canónicos desses destinos. O núcleo no repo continua **`.oxe/`** (SPEC/PLAN/VERIFY em Markdown).

## Configuração do projeto

- **`.oxe/config.json`**: fluxo (`discuss_before_plan`, `scan_max_age_days`, `compact_max_age_days`, `spec_required_sections`, …) e opcionalmente **`install`** (perfil e layout quando o utilizador corre o instalador **sem** flags IDE explícitas). Referência: `oxe/templates/CONFIG.md`. Para ignorar o bloco `install` numa corrida: **`--no-install-config`**.
- **Legado / brownfield** (COBOL, JCL, copybooks, VB6, SQL procedures): seguir também `oxe/workflows/references/legacy-brownfield.md` quando o repo ou o pedido indicar mainframe ou desktop legado — scan preenche os sete ficheiros sem assumir Node; plan/verify aceitam evidência por Grep/leitura/checklist.
- Sem TTY (CI): **`OXE_NO_PROMPT=1`** — padrões de layout/integração; o ficheiro `install` em `config.json` aplica-se se existir e as flags não sobrepuserem.

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*.md`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/plan-agents.json` (opcional, blueprint plan-agent; schema 2 com `runId` + `lifecycle`; **`/oxe-quick`** invalida), `.oxe/plan-agent-messages/` (opcional, handoffs agente→agente; ver `oxe/workflows/references/plan-agent-chat-protocol.md`), `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md` (opcional), `.oxe/NOTES.md`, `.oxe/RESUME.md`, `.oxe/CODEBASE-DELTA.md`, `.oxe/CHECKPOINTS.md`, `.oxe/checkpoints/*.md`, `.oxe/RESEARCH.md`, `.oxe/research/*.md`, `.oxe/VALIDATION-GAPS.md`, `.oxe/FORENSICS.md`, `.oxe/DEBUG.md`, `.oxe/UI-SPEC.md`, `.oxe/UI-REVIEW.md` (opcionais conforme trilha)
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado)

## CLI e SDK

- **`npx oxe-cc`** ou **`npx oxe-cc install`** — instalação (equivalentes).
- **`npx oxe-cc doctor`** — validação completa (Node, workflows do pacote vs projeto, JSON, coerência STATE, regras SPEC/PLAN, **avisos** não bloqueantes sobre estrutura dos `.md` de workflow quando aplicável).
- **`npx oxe-cc status`** — mais leve: coerência `.oxe/` + **um** próximo passo (não exige o mesmo rigor de workflows que o `doctor`). **`status --json`**: saída máquina-legível para CI (`nextStep`, `diagnostics`, `staleScan`, `staleCompact`, …). **`status --hints`**: lembretes de rotina (scan/compact antigos quando configurado); com **`--json --hints`** inclui o array **`hints`**.
- **`npx oxe-cc init-oxe`**, **`uninstall`**, **`update`** — ver `oxe-cc --help` ou README do pacote.
- **SDK (Node):** `require('oxe-cc')` expõe `runDoctorChecks`, `health`, `workflows`, `install`, `manifest`, `agents` — útil para CI (`lib/sdk/README.md`, `lib/sdk/index.d.ts`).

**WSL:** usar Node **nativo do WSL**; o `oxe-cc` recusa Node do Windows dentro do WSL (caminhos incorretos).

## Manutenção do pacote oxe-build

Ao alterar comportamento OXE, edite primeiro **`oxe/workflows/*.md`**; mantenha prompts em **`.github/prompts/`** e comandos Cursor gerados pelo sync alinhados a essa pasta (e as integrações multi-agente coerentes com `oxe-agent-install.cjs`).

**Autoria de workflows:** guia em **`oxe/templates/WORKFLOW_AUTHORING.md`**. Para rever um `.md` de passo contra o guia, use o workflow **`oxe/workflows/workflow-authoring.md`** (ou `.oxe/workflows/` no projeto alvo).
