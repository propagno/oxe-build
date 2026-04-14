# OXE — Workflow: route

<objective>
Desambiguar pedidos em **linguagem natural** e devolver **exatamente um** destino OXE (slash + ficheiro de workflow), **sem** criar ou alterar artefatos de contrato (`SPEC`, `PLAN`, etc.).

Este passo é **meta**: só orientação. A execução real pertence ao workflow apontado.
</objective>

<context>
- A tabela canónica de mapeamento vive em **`oxe/workflows/help.md`** na secção **Router (linguagem natural)**.
- Saída no chat: **um** comando (`/oxe-*` ou `npx oxe-cc …`) e **uma** frase de justificativa — alinhado a `next.md` (sem alternativas equiparáveis).
</context>

<process>
1. Ler a secção **Router** em `oxe/workflows/help.md` (ou `.oxe/workflows/help.md` no projeto).
2. Classificar a intenção do utilizador e escolher **uma** linha da tabela.
3. Responder apenas:
   - **Comando:** …
   - **Workflow:** `oxe/workflows/<nome>.md`
   - **Por quê:** (uma frase)
4. Não criar ficheiros em `.oxe/` salvo o utilizador pedir explícito registo; se o utilizador pedir rastreio: acrescentar uma linha em **`.oxe/STATE.md`** (ex.: `last_route: /oxe-scan — YYYY-MM-DD`).
</process>

<success_criteria>
- [ ] Foi indicado **um** destino, não uma lista de opções equivalentes.
- [ ] Nenhum conteúdo de SPEC/PLAN foi gerado neste passo.
</success_criteria>
