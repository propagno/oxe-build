---
name: oxe-route
agent: agent
description: OXE — Router: um pedido em linguagem natural → um comando/workflow
argument-hint: "[frase do utilizador]"
oxe_workflow_slug: route
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: routing
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 9d140800451c0ea9
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** route
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `9d140800451c0ea9`
- **Entrada de contexto prioritária:** `.oxe/context/packs/route.md` e `.oxe/context/packs/route.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow route --json`
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Seções esperadas:** Leitura atual · Recomendação · Motivo · Confiança
- **Bloqueios formais:** missing:state
- **Referência canónica:** `.oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE route** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/route.md`

Usa o texto adicional desta mensagem como intenção a classificar (tabela Router em `help.md`).
