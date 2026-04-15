---
name: oxe:help
description: Lista comandos OXE e o fluxo recomendado
argument-hint: ""
allowed-tools:
  - Read
oxe_workflow_slug: help
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: routing
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: d6221b02bf643a34
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** help
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `d6221b02bf643a34`
- **Entrada de contexto prioritária:** `.oxe/context/packs/help.md` e `.oxe/context/packs/help.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow help --json`
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Seções esperadas:** Leitura atual · Recomendação · Motivo · Confiança
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/help.md`

Execute integralmente esse ficheiro (inclui Cursor vs Copilot).
