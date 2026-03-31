# OXE — Workflow: next

<objective>
Inspecionar `.oxe/STATE.md` e a existência de `SPEC.md`, `PLAN.md`, `VERIFY.md` e `.oxe/codebase/` para recomendar **um** próximo passo OXE e uma frase de justificativa.
</objective>

<process>
1. Se `.oxe/` ou `STATE.md` não existir → recomendar **scan** e oferecer criar `.oxe` a partir de `oxe/templates/STATE.md`.
2. Se não houver `.oxe/codebase/*.md` → **scan**.
3. Se não houver `SPEC.md` → **spec**.
4. Se houver SPEC mas não PLAN → **plan**.
5. Se PLAN existe e VERIFY ausente ou desatualizado após mudanças → **verify**.
6. Se VERIFY passou → sugerir PR/commit ou novo **spec** para próxima feature.

Responder em formato fixo:

- **Próximo passo:** `scan` | `spec` | `plan` | `verify` (e equivalente Cursor `/oxe-*` ou prompt Copilot)
- **Por quê:** …
- **Artefatos em jogo:** (lista curta)
</process>
