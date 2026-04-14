---
name: oxe-dashboard
agent: agent
description: "OXE — visualizar runtime, ondas, checkpoints e saúde operacional da trilha"
argument-hint: "[foco opcional]"
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE dashboard** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/dashboard.md`

Usa o texto adicional desta mensagem como foco opcional.
