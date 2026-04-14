---
name: oxe-retro
agent: agent
description: OXE — Retrospectiva de ciclo: 3–5 lições prescritivas em .oxe/LESSONS.md para ciclos futuros
argument-hint: "[opcional: contexto extra sobre o ciclo — o que foi mais difícil, o que surpreendeu]"
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE retro** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/retro.md`

Lê VERIFY.md, FORENSICS.md, SUMMARY.md. `$ARGUMENTS` = contexto extra opcional.
