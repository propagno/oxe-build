---
description: "OXE — Modo rápido com Plan-Driven Dynamic Agents lean: objetivo → passos → agentes por domínio (opcional) → verificar"
argument-hint: "[objetivo em texto livre] [--agents para forçar PDDA]"
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
---

OXE — Modo rápido com Plan-Driven Dynamic Agents lean: objetivo → passos → agentes por domínio (opcional) → verificar

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

Executa o workflow **OXE quick** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/quick.md`

Usa o texto adicional desta mensagem como objetivo e contexto.
