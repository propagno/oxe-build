# OXE — fluxo spec-driven (Cursor + Copilot)

Este repositório (ou o pacote **oxe-cc** instalado) define o **OXE**: artefatos em **`.oxe/`** na raiz do projeto alvo e workflows em **`oxe/workflows/*.md`** ou **`.oxe/workflows/*.md`**, conforme a instalação.

## Quando aplicar

Se o usuário mencionar **OXE**, **oxe**, **/oxe-**, ou pedidos como “mapear o projeto”, “criar spec OXE”, “plano OXE com testes”, “verificar OXE”, trate como fluxo OXE e siga o arquivo de workflow correspondente abaixo.

## Workflows (fonte única)

| Passo | Arquivo | Gatilhos naturais (exemplos) |
|-------|---------|-------------------------------|
| Scan | `oxe/workflows/scan.md` | “oxe scan”, “mapear o repo”, “atualizar codebase OXE” |
| Spec | `oxe/workflows/spec.md` | “oxe spec”, “escrever SPEC.md”, “requisitos OXE” |
| Discuss | `oxe/workflows/discuss.md` | “oxe discuss”, “perguntas antes do plano”, “DISCUSS.md” |
| Plan | `oxe/workflows/plan.md` | “oxe plan”, “PLAN.md”, “plano com testes por tarefa”, “replan” |
| Quick | `oxe/workflows/quick.md` | “oxe quick”, “fix rápido OXE”, “QUICK.md” |
| Execute | `oxe/workflows/execute.md` | “oxe execute”, “executar onda”, “onda 2 OXE” |
| Verify | `oxe/workflows/verify.md` | “oxe verify”, “validar plano OXE”, “VERIFY.md” |
| Next | `oxe/workflows/next.md` | “oxe next”, “próximo passo OXE” |
| Review PR | `oxe/workflows/review-pr.md` | “revisar PR”, link `…/pull/10`, “diff entre branches” *(prompt: `/oxe-review-pr` no Copilot)* |
| Help | `oxe/workflows/help.md` | “oxe help”, “como usar OXE” |

**Regra:** leia o Markdown indicado e execute **todos** os passos e critérios de sucesso descritos nesse arquivo. Não atalhe: crie ou atualize os arquivos em `.oxe/` conforme o workflow.

## Onde ficam as integrações (após `npx oxe-cc`)

- **Cursor:** comandos em **`~/.cursor/commands/`** (slash `/oxe-*`).
- **GitHub Copilot (VS Code):** instruções mescladas em **`~/.copilot/copilot-instructions.md`** (bloco OXE) e **prompt files** em **`~/.copilot/prompts/`** (`oxe-*.prompt.md`). **Não** espere `.github/prompts/` no repositório do projeto para o Copilot — o instalador usa a pasta do **usuário**, alinhado ao GSD.
- **Copilot CLI (experimental):** com `oxe-cc --copilot-cli`, textos também em **`~/.claude/commands/`** e **`~/.copilot/commands/`** — depende da versão do CLI.

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*.md`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md`
- Templates: `oxe/templates/` (ou `.oxe/templates/` em layout aninhado)

## CLI útil

- **`npx oxe-cc doctor`** — validação completa (workflows do pacote, `config.json`, mapas, coerência STATE).
- **`npx oxe-cc status`** — um único próximo passo sugerido + coerência `.oxe/`.

## Manutenção do pacote oxe-build

Ao alterar comportamento OXE, edite primeiro **`oxe/workflows/*.md`**; mantenha comandos Cursor e prompts Copilot alinhados a essa pasta.
