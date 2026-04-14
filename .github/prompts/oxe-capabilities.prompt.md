---
name: oxe-capabilities
agent: agent
description: "OXE — gerir capabilities nativas do projeto"
argument-hint: "[list|install <id>|remove <id>|update]"
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: mixed
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** misto
- **Política de confiança:** explícita
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE capabilities** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/capabilities.md`

Usa o texto adicional desta mensagem como ação sobre capabilities.
