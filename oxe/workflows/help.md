# OXE — Workflow: help

<objective>
Apresentar o fluxo OXE (scan → spec → plan → execução → verify), o modo **quick**, o passo **execute**, e como invocar no **Cursor** e no **GitHub Copilot**. Mencionar o CLI `oxe-cc` (instalar, `doctor`, `status`, `init-oxe`).
</objective>

<context>
OXE é um fluxo **spec-driven** com artefatos em `.oxe/` no projeto alvo. Poucos comandos em relação ao GSD; o mesmo espírito de *context engineering* (arquivos pequenos por etapa). Instruções do Copilot no VS Code ficam em **`~/.copilot/`** após `npx oxe-cc` (bloco mesclado em `copilot-instructions.md` + **prompt files** em `~/.copilot/prompts/`), não em `.github/` dentro do repo.
</context>

<output>
## Cursor

Slash commands: `/oxe-scan`, `/oxe-spec`, `/oxe-discuss`, `/oxe-plan`, `/oxe-verify`, `/oxe-next`, `/oxe-quick`, `/oxe-execute`, `/oxe-help` (instalados em `~/.cursor/commands/` pelo `oxe-cc`).

## GitHub Copilot (VS Code)

1. **Instruções do usuário:** arquivo **`~/.copilot/copilot-instructions.md`** (conteúdo mesclado pelo instalador; contém o bloco OXE entre marcadores).
2. **Prompt files:** em **`~/.copilot/prompts/`** (ex.: `oxe-scan.prompt.md`). No chat, `/` e escolha **`oxe-scan`**, **`oxe-spec`**, etc. Requer `"chat.promptFiles": true` (exemplo em `.vscode/settings.json` do repo com layout `--global`).
3. **`oxe-review-pr`** — revisão de PR/diff (só prompt Copilot na pasta do usuário; no Cursor use linguagem natural + workflow `oxe/workflows/review-pr.md`).

## Fluxo completo

1. **scan** — após clonar ou quando o repositório mudar muito.
2. **spec** — descrever o que se quer (critérios com IDs **A1**, **A2**…).
3. **discuss** (opcional) — decisões antes do plano; recomendado se `discuss_before_plan` em `.oxe/config.json`.
4. **plan** — plano executável + **Verificar** por tarefa, ligado aos critérios da SPEC.
5. **execute** (opcional) — onda a onda com base no PLAN (ou passos do QUICK).
6. Implementar mudanças no agente/editor.
7. **verify** — validar tarefas **e** critérios SPEC antes de merge/PR.
8. **next** — retomar trabalho; no terminal: **`npx oxe-cc status`** sugere um único próximo passo.

## Modo rápido (quick)

- **`/oxe-quick`**: cria `.oxe/QUICK.md` (passos curtos + verificar) sem SPEC/PLAN longos. **Promova** para spec/plan se o trabalho crescer (muitos arquivos, API pública, segurança) — ver workflow `quick.md`.

## CLI (terminal)

- **`npx oxe-cc`** — instala workflows em `.oxe/` (ou `oxe/` + `.oxe/` com `--global`) e integrações em `~/.cursor`, `~/.copilot`, `~/.claude`.
- **`oxe-cc doctor`** — Node, workflows do pacote, `config.json`, mapas do codebase, **coerência STATE vs arquivos**, scan antigo (`scan_max_age_days`), etc.
- **`oxe-cc status`** — leve: coerência `.oxe/` + **um** próximo passo sugerido (espelha `next.md`).
- **`oxe-cc init-oxe`** — só bootstrap `.oxe/`.
- **`oxe-cc update` / `npx oxe-cc@latest --force`** — atualizar pacote.

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md`
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado, conforme instalação)

## Gatilhos em linguagem natural

Quando o usuário disser “oxe scan”, “oxe quick”, “executar onda OXE”, “revisar PR”, etc., siga o workflow correspondente em `oxe/workflows/*.md` (ou `.oxe/workflows/`).

**Copilot CLI (experimental):** `oxe-cc --copilot-cli` copia comandos para **`~/.claude/commands/`** e **`~/.copilot/commands/`** — depende da versão do CLI.
</output>
