---
name: oxe-ui-spec
agent: agent
description: OXE — Contrato UI (UI-SPEC.md) a partir da SPEC
argument-hint: "[âmbito UI opcional]"
oxe_workflow_slug: ui-spec
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 76ba6d1e0e2f02e6
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** ui-spec
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** plano
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `76ba6d1e0e2f02e6`
- **Entrada de contexto prioritária:** `.oxe/context/packs/ui-spec.md` e `.oxe/context/packs/ui-spec.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow ui-spec --json`
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Seções esperadas:** Objetivo · Plano · Validação · Riscos · Assumptions · Confiança
- **Bloqueios formais:** missing:state · missing:spec
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE ui-spec** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/ui-spec.md`

Usa o texto adicional desta mensagem como foco de ecrãs ou componentes, se houver.
