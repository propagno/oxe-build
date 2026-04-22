---
name: oxe:update
description: OXE — Atualiza workflows e integrações para a versão mais recente do oxe-cc no npm
argument-hint: "[--force] [--check] [--if-newer]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: update
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: afa0ff72a118df58
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** update
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `afa0ff72a118df58`
- **Entrada de contexto prioritária:** `.oxe/context/packs/update.md` e `.oxe/context/packs/update.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow update --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:state · missing:plan
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/update.md ou oxe/workflows/update.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Verifica versão no npm, reinstala com --force se necessário e valida com doctor. `$ARGUMENTS` = flags opcionais.
