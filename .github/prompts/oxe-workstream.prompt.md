---
name: oxe-workstream
agent: agent
description: "OXE — Trilhas paralelas: list, new <nome>, switch <nome>, status, close <nome> — cada trilha tem artefatos independentes em .oxe/workstreams/<nome>/"
argument-hint: "list | new <nome> | switch <nome> | status | close <nome>"
oxe_workflow_slug: workstream
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 82d171363381cc0d
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** workstream
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `82d171363381cc0d`
- **Entrada de contexto prioritária:** `.oxe/context/packs/workstream.md` e `.oxe/context/packs/workstream.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow workstream --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `.oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE workstream** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`.oxe/workflows/workstream.md`

Usa o texto adicional desta mensagem como subcomando e contexto.
