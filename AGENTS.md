# OXE — agentes (multi-IDE / multi-CLI)

Este repositório empacota o fluxo **OXE** (spec-driven, artefatos em `.oxe/`). O núcleo é agnóstico; o **`oxe-cc`** integra com **várias IDEs e CLIs** (Cursor e GitHub Copilot como caminho padrão conhecido, mais Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity quando instalado com **`--all-agents`** ou flags granulares).

- **npm:** `npx oxe-cc@latest` · pacote `oxe-cc` · [README.md](README.md)
- **Workflows canónicos:** [oxe/workflows/](oxe/workflows/) — editar aqui primeiro; todas as integrações apontam para estes ficheiros. Referência **legado / brownfield:** [oxe/workflows/references/legacy-brownfield.md](oxe/workflows/references/legacy-brownfield.md).
- **CLI:** `oxe-cc install | doctor | status | init-oxe | update | uninstall` — ver [README.md](README.md#cli-oxe-cc).
- **SDK:** `require('oxe-cc')` expõe `runDoctorChecks`, `health`, `workflows`, `install`, `manifest`, `agents` — ver [lib/sdk/README.md](lib/sdk/README.md).

---

## Os 8 comandos essenciais

```
/oxe              → onde estou / o que faço / help
/oxe-obs          → registrei algo importante (incorporado automaticamente)
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-scan         → mapeia o projeto (ou atualiza se já mapeado)
/oxe-spec         → nova feature: perguntas → requisitos → roteiro
/oxe-plan         → tarefas por onda (--agents para multi-agente)
/oxe-execute      → implementar (A: 1 sessão | B: por onda | C: por tarefa)
/oxe-verify       → validar (camadas 5+6 opcionais via config)
```

## Escape hatches (aparecem quando necessários)

```
/oxe-retro        → retrospectiva: 3–5 lições → .oxe/LESSONS.md
/oxe-forensics    → diagnóstico de falha persistente ou estado corrompido
/oxe-debug        → diagnóstico técnico inline (integrado ao execute)
/oxe-loop         → retry iterativo de onda até verify passar
/oxe-security     → auditoria OWASP Top 10 filtrada pelo stack
/oxe-research     → spike, mapa de sistema, engenharia reversa
/oxe-validate-gaps → auditoria de cobertura de testes
/oxe-discuss      → decisões D-NN antes do plano (discuss_before_plan: true)
/oxe-route        → traduz linguagem natural → comando OXE
/oxe-compact      → refresh do mapa de codebase
/oxe-checkpoint   → snapshot nomeado de sessão
/oxe-ui-spec      → contrato UI/UX derivado da SPEC
/oxe-ui-review    → auditoria de implementação UI
/oxe-review-pr    → revisão de PR/diff
/oxe-project      → milestone + workstream + checkpoint em um comando
/oxe-update       → atualiza workflows para a versão mais recente
```

## Profiles de execução (`profile` em `.oxe/config.json`)

| Profile | `discuss_before_plan` | `verification_depth` | `after_verify_suggest_uat` | `scan_max_age_days` |
|---------|-----------------------|---------------------|---------------------------|---------------------|
| `balanced` (padrão) | false | standard | false | 0 |
| `strict` | true | thorough | true | 14 |
| `fast` | false | quick | false | 0 |
| `legacy` | true | thorough | true | 0 |

Keys explícitas no `config.json` **prevalecem** sobre os valores do profile.

## Plan-Driven Dynamic Agents (PDDA)

Com `/oxe-plan --agents` (ou sugerido quando 3+ domínios detectados):
- `runId` único por demanda — nunca reutilizado entre planos
- `role` específico ao domínio desta entrega (não genérico)
- `model_hint` por agente: `"fast"` / `"balanced"` / `"powerful"` (schema v3)
- `persona` por agente: `executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist`, `db-specialist`
- Execute exibe o `model_hint` ao iniciar cada agente para o usuário configurar o modelo

Blueprints em `.oxe/plan-agents.json` (schema 3). Protocolo inter-agente: `oxe/workflows/references/plan-agent-chat-protocol.md`.

## Personas de agentes (`oxe/personas/`)

8 personas builtin: `executor`, `planner`, `verifier`, `researcher`, `debugger`, `architect`, `ui-specialist`, `db-specialist`. Personas customizadas do projeto ficam em `.oxe/personas/`.

## Integrações IDE

- **Cursor:** slash commands em `~/.cursor/commands/` (gerados por `npm run sync:cursor`)
- **GitHub Copilot (VS Code):** prompt files em `.github/prompts/` + `.github/copilot-instructions.md`
- **Claude Code:** commands em `~/.claude/commands/`
- **OpenCode / Gemini / Codex / Windsurf / Antigravity:** via `oxe-cc --all-agents`

## Instruções para agentes de IA

Quando o utilizador pedir uma etapa OXE por linguagem natural, seguir o ficheiro `oxe/workflows/<passo>.md` correspondente **sem atalhar passos**. Ler os artefatos em `.oxe/` antes de qualquer ação — nunca partir de suposições sobre o estado do projeto.

Os wrappers por runtime podem carregar metadata cognitiva (`oxe_reasoning_mode`, `oxe_question_policy`, `oxe_output_contract`, `oxe_tool_profile`, `oxe_confidence_policy`), mas o comportamento canónico continua no workflow. Use essa metadata para adaptar a postura do agente sem bifurcar a lógica do OXE por ferramenta.
