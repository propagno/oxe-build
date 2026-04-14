---
name: oxe-project
agent: agent
description: OXE — Gestão de projeto unificada: milestone, workstream e checkpoint
argument-hint: "milestone new <nome> | workstream switch <nome> | checkpoint [slug]"
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: routing
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE project** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/project.md`

`$ARGUMENTS` = subcomando: `milestone new|complete|status|audit`, `workstream new|switch|list|close <nome>`, `checkpoint [slug]`, ou vazio para status atual.
