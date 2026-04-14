---
description: "OXE — Gera .oxe/PLAN.md com verificação por tarefa"
argument-hint: "[opcional: --replan]"
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
---

OXE — Gera .oxe/PLAN.md com verificação por tarefa

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** plano
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE plan**. Lê e aplica **integralmente**:

`oxe/workflows/plan.md` (na raiz do repositório em contexto)

Se o utilizador pedir replanejamento, trata como `--replan` conforme o workflow.
