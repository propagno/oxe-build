---
name: oxe:ship
description: "OXE — Entregar: cria commit local com mensagem gerada de SPEC+PLAN+VERIFY. Flags: --message, --amend, --verify-first, --dry-run"
argument-hint: "[--message 'mensagem'] [--amend] [--verify-first] [--no-checks] [--dry-run]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: ship
oxe_reasoning_mode: execution
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: write_bounded
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 4a5d304e6ca781fc
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** ship
- **Modo:** execução
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** mutação limitada
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `4a5d304e6ca781fc`
- **Entrada de contexto prioritária:** `.oxe/context/packs/ship.md` e `.oxe/context/packs/ship.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow ship --json`
- Fazer reconhecimento curto antes de editar ou executar mutações.
- Trabalhar no menor write set viável e validar após cada fatia relevante.
- Parar e explicitar o bloqueio quando houver hipótese crítica não verificada.
- **Seções esperadas:** Contexto lido · Alvo da mudança · Validação executada · Resultado · Próximo passo
- **Bloqueios formais:** missing:verify_without_override · missing:tracked_changes
- **Referência canónica:** `oxe/workflows/references/reasoning-execution.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canônico:** `oxe/workflows/ship.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa `$ARGUMENTS` como flags de entrega (`--message`, `--amend`, `--verify-first`, `--no-checks`, `--dry-run`).
