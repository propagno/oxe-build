# OXE — agentes (GitHub Copilot / compatível)

Este repositório empacota o fluxo **OXE** (spec-driven, artefatos em `.oxe/`).

- **Instruções do repositório:** [.github/copilot-instructions.md](.github/copilot-instructions.md) — aplicadas automaticamente no Copilot Chat quando o repo está em contexto.
- **Workflows canónicos:** [oxe/workflows/](oxe/workflows/) — editar aqui primeiro; Cursor e Copilot apontam para estes ficheiros.
- **Prompt files (Copilot / VS Code):** [.github/prompts/*.prompt.md](.github/prompts/) — invocar com `/` no chat (ex. `/oxe-scan`) após `chat.promptFiles` estar ativo.

Quando o utilizador pedir uma etapa OXE por linguagem natural, segue o ficheiro `oxe/workflows/<passo>.md` correspondente sem atalhar passos.
