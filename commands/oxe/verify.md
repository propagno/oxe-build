---
name: oxe:verify
description: Valida implementação contra SPEC e PLAN; produz checklist e gaps
argument-hint: "[Tn opcional — focar uma tarefa]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
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

**Workflow canónico:** `oxe/workflows/verify.md`

Execute integralmente esse ficheiro. Se `$ARGUMENTS` indicar um id de tarefa (ex. `T2`), restringir a verificação a essa tarefa.
