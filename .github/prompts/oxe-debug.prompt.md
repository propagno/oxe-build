---
name: oxe-debug
agent: agent
description: OXE — Debug técnico durante execute (DEBUG.md, hipótese/evidência)
argument-hint: "[Tn opcional, stack ou comando que falhou]"
oxe_workflow_slug: debug
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 7912f4caf80c2915
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** debug
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `7912f4caf80c2915`
- **Entrada de contexto prioritária:** `.oxe/context/packs/debug.md` e `.oxe/context/packs/debug.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow debug --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE debug** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/debug.md`

Usa o texto adicional desta mensagem como sintoma, **Tn** do PLAN se souber, ou saída de erro.
