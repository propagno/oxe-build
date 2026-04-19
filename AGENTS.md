# OXE — agentes (multi-IDE / multi-CLI)

Este repositório empacota o fluxo **OXE** (spec-driven, artefatos em `.oxe/`). O núcleo é agnóstico; o **`oxe-cc`** integra com **várias IDEs e CLIs** (Cursor e GitHub Copilot como caminho padrão conhecido, mais Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity quando instalado com **`--all-agents`** ou flags granulares).

- **npm:** `npx oxe-cc@latest` · pacote `oxe-cc` · [README.md](README.md)
- **Workflows canónicos:** [oxe/workflows/](oxe/workflows/) — editar aqui primeiro; todas as integrações apontam para estes ficheiros. Referência **legado / brownfield:** [oxe/workflows/references/legacy-brownfield.md](oxe/workflows/references/legacy-brownfield.md).
- **CLI:** `oxe-cc install | doctor | status | init-oxe | update | uninstall` — ver [README.md](README.md#cli-oxe-cc).
- **SDK:** `require('oxe-cc')` expõe `runDoctorChecks`, `health`, `workflows`, `install`, `manifest`, `agents` — ver [lib/sdk/README.md](lib/sdk/README.md).

---

## Trilha principal (6 comandos)

```
/oxe              → onde estou / o que faço / help / perguntas situacionais
/oxe-quick        → tarefa pequena, sem cerimônia
/oxe-spec         → nova feature: perguntas → requisitos → roteiro
                    flags: --refresh, --full, --research, --deep, --ui
/oxe-plan         → tarefas por onda (--agents para multi-agente)
/oxe-execute      → implementar (A: 1 sessão | B: por onda | C: por tarefa)
                    flags: --note, --debug, --deep-diagnosis, --checkpoint, --iterative
/oxe-verify       → validar e fechar o ciclo (retro automática)
                    flags: --gaps, --security, --ui, --pr, --diff, --skip-retro
```

## Trilha avançada

```
/oxe-session      → criar, alternar, retomar, fechar ou migrar sessões OXE
/oxe-dashboard    → visão web para revisão de equipe e aprovação do plano
```

## Administrativa / plataforma

```
/oxe-capabilities → catálogo nativo de capabilities
/oxe-skill        → skills OXE via @<id>
oxe-cc azure      → provider Azure local-first
```

## Comandos legados (v1.1.0 — funcionam com aviso de migração)

```
/oxe-ask          → incorporado por /oxe "pergunta"
/oxe-scan         → incorporado por /oxe-spec --refresh / --full
/oxe-research     → incorporado por /oxe-spec --research
/oxe-ui-spec      → incorporado por /oxe-spec --ui
/oxe-obs          → incorporado por /oxe-execute --note
/oxe-debug        → incorporado por /oxe-execute --debug
/oxe-forensics    → incorporado por /oxe-execute --deep-diagnosis
/oxe-checkpoint   → incorporado por /oxe-execute --checkpoint
/oxe-loop         → incorporado por /oxe-execute --iterative
/oxe-validate-gaps → incorporado por /oxe-verify --gaps
/oxe-security     → incorporado por /oxe-verify --security
/oxe-ui-review    → incorporado por /oxe-verify --ui
/oxe-review-pr    → incorporado por /oxe-verify --pr
/oxe-retro        → incorporado por /oxe-verify (retro automática)
/oxe-project      → incorporado por /oxe-session milestone|workstream
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
