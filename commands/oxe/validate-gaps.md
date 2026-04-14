---
name: oxe:validate-gaps
description: OXE — Auditoria Nyquist-lite (.oxe/VALIDATION-GAPS.md) após verify
argument-hint: "[opcional: Tn ou A*]"
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

**Workflow canónico:** `oxe/workflows/validate-gaps.md`

Execute integralmente esse ficheiro na raiz do repositório. Pré-requisito: `VERIFY.md` e `PLAN.md`. `$ARGUMENTS` = foco opcional.
