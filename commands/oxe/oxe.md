---
name: oxe
description: OXE — Entrada universal: próximo passo, roteamento de linguagem natural ou help dos 8 comandos essenciais
argument-hint: "[contexto | 'help' | vazio]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: oxe
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: routing
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: d7f65cd3f77b0abc
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** oxe
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `d7f65cd3f77b0abc`
- **Entrada de contexto prioritária:** `.oxe/context/packs/oxe.md` e `.oxe/context/packs/oxe.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow oxe --json`
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Seções esperadas:** Leitura atual · Recomendação · Motivo · Confiança
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canônico:** `oxe/workflows/oxe.md`

Execute integralmente esse ficheiro. `$ARGUMENTS`: vazio → próximo passo; texto → roteamento inteligente; "help" → 8 comandos essenciais.
