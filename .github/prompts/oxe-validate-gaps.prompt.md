---
name: oxe-validate-gaps
agent: agent
description: OXE — Gaps de cobertura pós-verify (VALIDATION-GAPS.md)
argument-hint: "[opcional: foco Tn ou A*]"
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

Executa o workflow **OXE validate-gaps** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/validate-gaps.md`

Requer `VERIFY.md` e `PLAN.md` já existentes. Texto adicional: foco opcional em tarefa **Tn** ou critério **A***.
