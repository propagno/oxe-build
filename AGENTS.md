# OXE — agentes (GitHub Copilot / compatível)

Este repositório empacota o fluxo **OXE** (spec-driven, artefatos em `.oxe/`).

- **npm:** o nome do pacote é **`oxe-cc`** (`npx oxe-cc@latest` quando estiver publicado; se `npm view oxe-cc` der 404, usar `npm link` a partir deste repo ou `node bin/oxe-cc.js`).
- **Instruções do repositório:** [.github/copilot-instructions.md](.github/copilot-instructions.md) — aplicadas automaticamente no Copilot Chat quando o repo está em contexto.
- **Workflows canónicos:** [oxe/workflows/](oxe/workflows/) — editar aqui primeiro; Cursor e Copilot apontam para estes ficheiros (inclui `quick.md`, `execute.md`).
- **CLI:** `oxe-cc` instala assets e bootstrap (`.oxe/STATE.md`, `config.json`, `codebase/`); `oxe-cc doctor` valida workflows, JSON de config e mapa scan; `oxe-cc init-oxe` só inicializa `.oxe/`.
- **Prompt files (Copilot / VS Code):** [.github/prompts/*.prompt.md](.github/prompts/) — invocar com `/` no chat (ex. `/oxe-scan`, `/oxe-review-pr` para diff tipo PR) após `chat.promptFiles` estar ativo.

Quando o utilizador pedir uma etapa OXE por linguagem natural, segue o ficheiro `oxe/workflows/<passo>.md` correspondente sem atalhar passos.
