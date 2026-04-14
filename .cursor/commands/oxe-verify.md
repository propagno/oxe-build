---
description: "OXE — Valida implementação (.oxe/VERIFY.md)"
argument-hint: "[opcional: Tn]"
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
---

OXE — Valida implementação (.oxe/VERIFY.md)

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

Executa o workflow **OXE verify**. Lê e aplica **integralmente**:

`oxe/workflows/verify.md` (na raiz do repositório em contexto)

Se o utilizador indicar uma tarefa `Tn`, restringe a verificação a essa tarefa.
