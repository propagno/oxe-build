---
description: "OXE — Próximo passo (lê STATE.md)"
oxe_workflow_slug: next
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: routing
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 6c91889eba921d36
---

OXE — Próximo passo (lê STATE.md)

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** next
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `6c91889eba921d36`
- **Entrada de contexto prioritária:** `.oxe/context/packs/next.md` e `.oxe/context/packs/next.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow next --json`
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Seções esperadas:** Leitura atual · Recomendação · Motivo · Confiança
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE next**. Lê e aplica **integralmente**:

`oxe/workflows/next.md` (na raiz do repositório em contexto)
