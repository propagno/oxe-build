---
name: oxe:dashboard
description: "Visualizar o runtime operacional, ondas, checkpoints e sinais principais da trilha OXE"
argument-hint: "[foco opcional]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
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

**Workflow canónico:** `oxe/workflows/dashboard.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como foco opcional.
