# OXE — Workflow: next

<objective>
Inspecionar `.oxe/STATE.md` e a existência de `SPEC.md`, `PLAN.md`, `QUICK.md`, `VERIFY.md` e `.oxe/codebase/` para recomendar **um** próximo passo OXE e uma frase de justificativa.
</objective>

<process>
1. Se `.oxe/` ou `STATE.md` não existir → recomendar **scan** ou `oxe-cc init-oxe` / primeiro **scan** e oferecer criar `.oxe` a partir de `oxe/templates/STATE.md`.
2. Se não houver `.oxe/codebase/*.md` (e o trabalho não for só um quick isolado) → **scan**.
3. Se `STATE.md` indicar fase `quick_active` ou existir `QUICK.md` sem PLAN → recomendar **execute** (se ainda há passos) ou **verify** depois de implementar; se o trabalho cresceu → **spec**.
4. Se não houver `SPEC.md` e não estiveres em modo quick intencional → **spec** (ou **quick** se o utilizador quiser só um fix pequeno).
5. Se houver SPEC mas não PLAN → se `.oxe/config.json` tiver `discuss_before_plan: true` e faltar **`.oxe/DISCUSS.md`** (ou estiver incompleto) → **discuss**; senão → **plan**.
6. Se PLAN (ou QUICK) existe, há implementação pendente e ainda não verificaste → **execute** opcionalmente, depois **verify**.
7. Se VERIFY ausente ou desatualizado após mudanças → **verify**.
8. Se VERIFY passou → sugerir PR/commit ou novo **spec** / **quick** para próxima tarefa.

Responder em formato fixo:

- **Próximo passo:** `scan` | `spec` | `discuss` | `plan` | `quick` | `execute` | `verify` (Cursor: `/oxe-discuss`, …; `oxe:discuss`, …)
- **Por quê:** …
- **Artefatos em jogo:** (lista curta)
</process>
