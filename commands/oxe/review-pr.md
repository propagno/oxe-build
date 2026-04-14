---
name: oxe:review-pr
description: OXE — Revisão de diff/PR: analisa alterações, riscos, convenções e sugestões acionáveis
argument-hint: "<URL do PR ou branch:base..head>"
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

**Workflow canônico:** `oxe/workflows/review-pr.md`

Execute integralmente esse ficheiro. Recebe URL de PR do GitHub (`org/repo#N`) ou par de branches/SHAs. `$ARGUMENTS` = referência do diff.
