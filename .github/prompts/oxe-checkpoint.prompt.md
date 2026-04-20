---
name: oxe-checkpoint
agent: agent
description: OXE — Checkpoint nomeado (.oxe/checkpoints/ + índice)
argument-hint: "<slug> [nota breve]"
oxe_workflow_slug: checkpoint
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 536e476616b47060
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** checkpoint
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `536e476616b47060`
- **Entrada de contexto prioritária:** `.oxe/context/packs/checkpoint.md` e `.oxe/context/packs/checkpoint.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow checkpoint --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE checkpoint** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/checkpoint.md`

O **primeiro** argumento deve ser o **slug** (ex. `pre-migracao-api`); o resto é nota livre.
