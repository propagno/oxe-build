---
name: oxe-workstream
agent: agent
description: "OXE — Trilhas paralelas: list, new <nome>, switch <nome>, status, close <nome> — cada trilha tem artefatos independentes em .oxe/workstreams/<nome>/"
argument-hint: "list | new <nome> | switch <nome> | status | close <nome>"
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE workstream** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/workstream.md`

Usa o texto adicional desta mensagem como subcomando e contexto.
