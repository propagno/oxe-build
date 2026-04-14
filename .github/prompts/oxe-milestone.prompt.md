---
name: oxe-milestone
agent: agent
description: "OXE — Marcos de entrega (M-NN): new, complete (arquiva em .oxe/milestones/M-NN/), status, audit"
argument-hint: "new <nome> | complete | status | audit"
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE milestone** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/milestone.md`

Usa o texto adicional desta mensagem como subcomando e contexto.
