# OXE — fluxo spec-driven (Cursor + Copilot)

Este repositório define o **OXE**: artefatos em `.oxe/` na raiz do projeto alvo e workflows em `oxe/workflows/*.md`.

## Quando aplicar

Se o utilizador mencionar **OXE**, **oxe**, **/oxe-**, ou pedidos como “mapear o projeto”, “criar spec OXE”, “plano OXE com testes”, “verificar OXE”, trata como fluxo OXE e segue o ficheiro de workflow correspondente abaixo.

## Workflows (fonte única)

| Passo | Ficheiro | Gatilhos naturais (exemplos) |
|-------|----------|----------------------------|
| Scan | `oxe/workflows/scan.md` | “oxe scan”, “mapear o repo”, “atualizar codebase OXE” |
| Spec | `oxe/workflows/spec.md` | “oxe spec”, “escrever SPEC.md”, “requisitos OXE” |
| Plan | `oxe/workflows/plan.md` | “oxe plan”, “PLAN.md”, “plano com testes por tarefa” |
| Verify | `oxe/workflows/verify.md` | “oxe verify”, “validar plano OXE”, “VERIFY.md” |
| Next | `oxe/workflows/next.md` | “oxe next”, “próximo passo OXE” |
| Help | `oxe/workflows/help.md` | “oxe help”, “como usar OXE” |

**Regra:** lê o Markdown indicado e executa **todos** os passos e critérios de sucesso descritos nesse ficheiro. Não atalhes: cria ou atualiza os ficheiros em `.oxe/` conforme o workflow.

## Artefatos

- `.oxe/STATE.md`, `.oxe/codebase/*.md`, `.oxe/SPEC.md`, `.oxe/PLAN.md`, `.oxe/VERIFY.md`
- Templates: `oxe/templates/`

## Cursor vs Copilot

- **Cursor:** slash commands em `.cursor/commands/oxe-*.md` apontam para os mesmos workflows.
- **Copilot:** prompt files em `.github/prompts/oxe-*.prompt.md` (anexar no Chat → Prompt…) incluem o workflow via `#file:`.

## Manutenção deste pacote (oxe-build)

Ao alterar comportamento OXE, edita primeiro `oxe/workflows/*.md`; mantém comandos Cursor e prompts Copilot alinhados com essa pasta.
