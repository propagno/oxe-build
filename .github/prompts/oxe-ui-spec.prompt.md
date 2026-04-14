---
name: oxe-ui-spec
agent: agent
description: OXE — Contrato UI (UI-SPEC.md) a partir da SPEC
argument-hint: "[âmbito UI opcional]"
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
---

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

Executa o workflow **OXE ui-spec** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/ui-spec.md`

Usa o texto adicional desta mensagem como foco de ecrãs ou componentes, se houver.
