---
name: oxe-security
agent: agent
description: OXE — Auditoria de segurança OWASP (.oxe/SECURITY.md): P0/P1/P2 vinculados ao stack
argument-hint: "[opcional: categoria OWASP, módulo ou arquivo de foco]"
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

Executa o workflow **OXE security** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/security.md`

Lê `.oxe/codebase/STACK.md` para determinar categorias OWASP aplicáveis. `$ARGUMENTS` = foco opcional.
