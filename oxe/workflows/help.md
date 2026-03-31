# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → plan → execução → verify), o modo **quick**, o passo **execute**, e como invocar no **Cursor** e no **GitHub Copilot**. Mencionar CLI `oxe-cc` (instalar, `doctor`, `init-oxe`).
</objective>

<context>
OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no repositório alvo. Menos comandos que GSD; mesmo espírito de context engineering (ficheiros pequenos por etapa).
</context>

<output>
## Cursor

Slash commands: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, `/oxe-plan`, `/oxe-verify`, `/oxe-next`, `/oxe-quick`, `/oxe-execute`, `/oxe-help` (definidos em `.cursor/commands/`).

## GitHub Copilot (VS Code / IDE)

1. **Instruções do repositório:** `.github/copilot-instructions.md` (ativas no chat quando o repositório está em contexto).
2. **Prompt files:** no chat, escrever `/` e escolher **`oxe-scan`**, **`oxe-spec`**, **`oxe-discuss`**, **`oxe-plan`**, **`oxe-verify`**, **`oxe-next`**, **`oxe-quick`**, **`oxe-execute`**, **`oxe-help`**. Requer `chat.promptFiles`: true.

## Fluxo completo

1. **scan** — após clonar ou quando o repo mudar muito.
2. **spec** — descrever o que se quer.
3. **discuss** (opcional) — perguntas objetivas antes do plano; recomendado se `discuss_before_plan` em `.oxe/config.json`.
4. **plan** — plano executável + verificação por tarefa.
5. **execute** (opcional) — onda a onda com base no PLAN (ou passos do QUICK).
6. Implementar mudanças no agente/editor.
7. **verify** — validar antes de merge/PR (inclui rascunho de commit / checklist PR se configurado).
8. **next** — retomar trabalho.

## Modo rápido (quick)

- **`/oxe-quick`**: cria `.oxe/QUICK.md` (passos curtos + verificar) sem SPEC/PLAN longos. Promover a spec/plan se o trabalho crescer (muitos ficheiros, API pública, segurança).

## CLI (terminal)

- **`npx oxe-cc`** — instala `oxe/`, Cursor, Copilot, etc.; por omissão cria **`.oxe/`** mínimo (`STATE.md` a partir do template) se ainda não existir.
- **`oxe-cc doctor`** — verifica Node, workflows, JSON válido em `.oxe/config.json`, mapa codebase após scan (lista o que falta).
- **`oxe-cc init-oxe`** — só inicializa `.oxe/` (STATE + `config.json` + pasta `codebase/`), sem reinstalar o resto.
- **`oxe-cc --no-init-oxe`** — instala workflows sem criar `.oxe/`.

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md`

## Gatilhos naturais (Copilot / chat)

Quando o utilizador disser “oxe scan”, “oxe quick”, “executar onda OXE”, etc., seguir o workflow correspondente em `oxe/workflows/*.md`.
</output>
