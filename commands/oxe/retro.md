---
name: oxe:retro
description: OXE — Retrospectiva de ciclo: sintetiza lições prescritivas em .oxe/LESSONS.md (alimenta ciclos futuros automaticamente)
argument-hint: "[opcional: contexto sobre o ciclo]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
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

**Workflow canônico:** `oxe/workflows/retro.md`

Execute integralmente esse ficheiro. Lê VERIFY.md, FORENSICS.md, SUMMARY.md para sintetizar 3–5 lições prescritivas. `$ARGUMENTS` = contexto extra opcional.
