---
name: oxe
agent: agent
description: OXE — Entrada universal: próximo passo / roteamento / help dos 8 comandos essenciais
argument-hint: "[contexto em linguagem natural | 'help' | vazio para próximo passo]"
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

Executa o workflow **OXE** (entrada universal) no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/oxe.md`

`$ARGUMENTS`: vazio → próximo passo; texto → roteamento; "help" → 8 comandos essenciais.
