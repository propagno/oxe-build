# OXE — agentes (multi-IDE / multi-CLI)

Este repositório empacota o fluxo **OXE** (spec-driven, artefatos em `.oxe/`). O núcleo é agnóstico; o **`oxe-cc`** integra com **várias IDEs e CLIs** (Cursor e GitHub Copilot como caminho padrão conhecido, mais Claude, OpenCode, Gemini, Codex, Windsurf, Antigravity quando instalado com **`--all-agents`** ou flags granulares).

- **npm:** o nome do pacote é **`oxe-cc`** (`npx oxe-cc@latest` quando estiver publicado; se `npm view oxe-cc` der 404, usar `npm link` a partir deste repo ou `node bin/oxe-cc.js`).
- **Workflows canónicos:** [oxe/workflows/](oxe/workflows/) — editar aqui primeiro; todas as integrações apontam para estes ficheiros (inclui `quick.md`, `execute.md`). Referência **legado / brownfield:** [oxe/workflows/references/legacy-brownfield.md](oxe/workflows/references/legacy-brownfield.md) (COBOL, JCL, copybooks, VB6, SP).
- **Instruções do repositório:** [.github/copilot-instructions.md](.github/copilot-instructions.md) — aplicadas automaticamente no **GitHub Copilot Chat** quando o repo está em contexto (outras ferramentas usam os seus próprios homes após `oxe-cc install`).
- **CLI:** `oxe-cc` instala assets e bootstrap (`.oxe/STATE.md`, `config.json`, `codebase/`); `oxe-cc doctor` valida workflows, JSON de config, coerência STATE vs artefatos e regras opcionais de SPEC/PLAN; `oxe-cc status` mostra coerência `.oxe/` e **um** próximo passo; `oxe-cc init-oxe` só inicializa `.oxe/`.
- **SDK:** `require('oxe-cc')` expõe `runDoctorChecks`, `health`, `workflows`, `install`, `manifest`, `agents` — ver [lib/sdk/README.md](lib/sdk/README.md).
- **Prompt files (Copilot / VS Code):** [.github/prompts/*.prompt.md](.github/prompts/) — invocar com `/` no chat (ex. `/oxe-scan`, `/oxe-forensics`, `/oxe-debug`, `/oxe-route`, `/oxe-research`, `/oxe-validate-gaps`, `/oxe-ui-spec`, `/oxe-ui-review`, `/oxe-update`, `/oxe-review-pr` para diff tipo PR) após `chat.promptFiles` estar ativo. Cursor: `npm run sync:cursor` gera `.cursor/commands/` a partir destes prompts.
- **Copilot CLI:** `oxe-cc --copilot-cli` → skills em **`~/.copilot/skills/`** (`/oxe`, `/oxe-scan`, …); após instalar use **`/skills reload`**. Cópia extra em `~/.claude/commands/` para compatibilidade.
- **Multi-agente:** `oxe-cc --all-agents` replica comandos/skills nos homes de **OpenCode**, **Gemini**, **Codex**, **Windsurf**, **Antigravity** (além de Cursor, Copilot, Claude); ver `README.md` e `bin/lib/oxe-agent-install.cjs`.

Quando o utilizador pedir uma etapa OXE por linguagem natural, segue o ficheiro `oxe/workflows/<passo>.md` correspondente sem atalhar passos.
