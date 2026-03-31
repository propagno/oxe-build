# OXE — agentes (GitHub Copilot / compatível)

Este repositório empacota o fluxo **OXE** (spec-driven, artefatos em `.oxe/`).

- **npm:** o nome do pacote é **`oxe-cc`** (`npx oxe-cc@latest` quando estiver publicado; se `npm view oxe-cc` der 404, usar `npm link` a partir deste repo ou `node bin/oxe-cc.js`).
- **Instruções do repositório:** [.github/copilot-instructions.md](.github/copilot-instructions.md) — aplicadas automaticamente no Copilot Chat quando o repo está em contexto.
- **Workflows canónicos:** [oxe/workflows/](oxe/workflows/) — editar aqui primeiro; Cursor e Copilot apontam para estes ficheiros (inclui `quick.md`, `execute.md`).
- **CLI:** `oxe-cc` instala assets e bootstrap (`.oxe/STATE.md`, `config.json`, `codebase/`); `oxe-cc doctor` valida workflows, JSON de config, coerência STATE vs artefatos e regras opcionais de SPEC/PLAN; `oxe-cc status` mostra coerência `.oxe/` e **um** próximo passo; `oxe-cc init-oxe` só inicializa `.oxe/`.
- **SDK:** `require('oxe-cc')` expõe `runDoctorChecks`, `health`, `workflows`, `install`, `manifest`, `agents` — ver [lib/sdk/README.md](lib/sdk/README.md).
- **Prompt files (Copilot / VS Code):** [.github/prompts/*.prompt.md](.github/prompts/) — invocar com `/` no chat (ex. `/oxe-scan`, `/oxe-review-pr` para diff tipo PR) após `chat.promptFiles` estar ativo.
- **Copilot CLI:** `oxe-cc --copilot-cli` → skills em **`~/.copilot/skills/`** (`/oxe`, `/oxe-scan`, …); após instalar use **`/skills reload`**. Cópia extra em `~/.claude/commands/` para compatibilidade.
- **Multi-agente:** `oxe-cc --all-agents` replica comandos/skills nos homes de **OpenCode**, **Gemini**, **Codex**, **Windsurf**, **Antigravity** (além de Cursor, Copilot, Claude); ver `README.md` e `bin/lib/oxe-agent-install.cjs`.

Quando o utilizador pedir uma etapa OXE por linguagem natural, segue o ficheiro `oxe/workflows/<passo>.md` correspondente sem atalhar passos.
