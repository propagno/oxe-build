# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → plan → execução → verify) e como invocá-lo no **Cursor** e no **GitHub Copilot**.
</objective>

<context>
OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no repositório alvo. Menos comandos que GSD; mesmo espírito de context engineering (ficheiros pequenos por etapa).
</context>

<output>
## Cursor

Slash commands: `/oxe-scan`, `/oxe-spec`, `/oxe-plan`, `/oxe-verify`, `/oxe-next`, `/oxe-help` (definidos em `.cursor/commands/`).

## GitHub Copilot (VS Code / IDE)

1. **Instruções do repositório:** `.github/copilot-instructions.md` (ativas no chat quando o repositório está em contexto).
2. **Prompt files:** no chat, escrever `/` e escolher **`oxe-scan`**, **`oxe-spec`**, **`oxe-plan`**, **`oxe-verify`**, **`oxe-next`**, **`oxe-help`** (definidos em `.github/prompts/*.prompt.md` com `name` no frontmatter). Requer `chat.promptFiles`: true (este repo inclui `.vscode/settings.json`).

## Fluxo

1. **scan** — após clonar ou quando o repo mudar muito.
2. **spec** — descrever o que se quer.
3. **plan** — plano executável + verificação por tarefa.
4. Implementar mudanças no agente/editor.
5. **verify** — validar antes de merge/PR.
6. **next** — retomar trabalho.

## Artefatos

- `.oxe/STATE.md`, `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/PLAN.md`, `.oxe/VERIFY.md`

## Gatilhos naturais (Copilot / chat)

Quando o utilizador disser “oxe scan”, “executar OXE spec”, “mapear o projeto OXE”, etc., seguir o workflow correspondente em `oxe/workflows/*.md`.
</output>
