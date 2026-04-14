---
name: oxe:route
description: OXE — Router linguagem natural → um comando/workflow
argument-hint: "[frase do utilizador]"
allowed-tools:
  - Read
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: routing
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/route.md`

Execute integralmente esse ficheiro. Usa `$ARGUMENTS` como pedido a classificar (ver tabela Router em `help.md`).
