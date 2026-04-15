---
name: oxe-plan-agent
description: "OXE — PLAN.md + plan-agents.json (plano orientado a agentes / ondas)"
oxe_workflow_slug: plan-agent
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 0b2f34a325711ad6
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** plan-agent
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** plano
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `0b2f34a325711ad6`
- **Entrada de contexto prioritária:** `.oxe/context/packs/plan-agent.md` e `.oxe/context/packs/plan-agent.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow plan-agent --json`
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Seções esperadas:** Objetivo · Plano · Validação · Riscos · Assumptions · Confiança
- **Bloqueios formais:** missing:state · missing:spec
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE plan-agent**. Lê e aplica **integralmente**:

`oxe/workflows/plan-agent.md` (na raiz do repositório em contexto)

Se o utilizador pedir replanejamento, trata como **`--replan`** conforme o workflow.
