# OXE — fluxo spec-driven (Cursor + Copilot)

Este repositório define o **OXE**: artefatos em `.oxe/` na raiz do projeto alvo e workflows em `oxe/workflows/*.md`.

## Quando aplicar

Se o utilizador mencionar **OXE**, **oxe**, **/oxe-**, ou pedidos como “mapear o projeto”, “criar spec OXE”, “plano OXE com testes”, “verificar OXE”, trata como fluxo OXE e segue o ficheiro de workflow correspondente abaixo.

## Workflows (fonte única)

| Passo | Ficheiro | Gatilhos naturais (exemplos) |
|-------|----------|----------------------------|
| Scan | `oxe/workflows/scan.md` | “oxe scan”, “mapear o repo”, “atualizar codebase OXE” |
| Spec | `oxe/workflows/spec.md` | “oxe spec”, “escrever SPEC.md”, “requisitos OXE” |
| Discuss | `oxe/workflows/discuss.md` | “oxe discuss”, “perguntas antes do plano”, “DISCUSS.md” |
| Plan | `oxe/workflows/plan.md` | “oxe plan”, “PLAN.md”, “plano com testes por tarefa”, “replan” |
| Quick | `oxe/workflows/quick.md` | “oxe quick”, “fix rápido OXE”, “QUICK.md” |
| Execute | `oxe/workflows/execute.md` | “oxe execute”, “executar onda”, “onda 2 OXE” |
| Verify | `oxe/workflows/verify.md` | “oxe verify”, “validar plano OXE”, “VERIFY.md” |
| Next | `oxe/workflows/next.md` | “oxe next”, “próximo passo OXE” |
| Review PR | `oxe/workflows/review-pr.md` | “revisar PR”, link `…/pull/10`, “diff entre branches”, “code review OXE” *(prompt: `/oxe-review-pr`)* |
| Help | `oxe/workflows/help.md` | “oxe help”, “como usar OXE” |

**Regra:** lê o Markdown indicado e executa **todos** os passos e critérios de sucesso descritos nesse ficheiro. Não atalhes: cria ou atualiza os ficheiros em `.oxe/` conforme o workflow.

## Artefatos

- `.oxe/STATE.md`, `.oxe/config.json` (opcional), `.oxe/codebase/*.md`, `.oxe/SPEC.md`, `.oxe/DISCUSS.md` (opcional), `.oxe/PLAN.md`, `.oxe/VERIFY.md`, `.oxe/QUICK.md`, `.oxe/SUMMARY.md`
- Templates: `oxe/templates/`

## Cursor vs Copilot

- **Cursor:** slash commands em `.cursor/commands/oxe-*.md` apontam para os mesmos workflows.
- **Copilot (VS Code Chat):** prompt files em `.github/prompts/oxe-*.prompt.md`; cada um indica o workflow em `oxe/workflows/<passo>.md` na raiz do repo. **`oxe-review-pr`** existe só como prompt Copilot (não há slash command Cursor correspondente).
- **Copilot CLI (terminal, experimental):** com `oxe-cc --copilot-cli`, os mesmos textos são copiados para **`.claude/commands/oxe-*.md`** — versões recentes do CLI podem expor **`/oxe-scan`**, etc. Isto depende da versão do `copilot`; não faz parte do contrato estável do OXE.

## Manutenção deste pacote (oxe-build)

Ao alterar comportamento OXE, edita primeiro `oxe/workflows/*.md`; mantém comandos Cursor e prompts Copilot alinhados com essa pasta.
