---
name: oxe:capabilities
description: "Gerir capabilities nativas do projeto OXE"
argument-hint: "[list|install <id>|remove <id>|update]"
allowed-tools:
  - Read
  - Bash
  - Glob
oxe_workflow_slug: capabilities
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: mixed
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: c2dbc0e05602cd19
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** capabilities
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** misto
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `c2dbc0e05602cd19`
- **Entrada de contexto prioritária:** `.oxe/context/packs/capabilities.md` e `.oxe/context/packs/capabilities.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow capabilities --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/capabilities.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como ação sobre capabilities.
