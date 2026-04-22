---
name: oxe:plan-agent
description: Gera PLAN.md e plan-agents.json (blueprint de agentes e ondas)
argument-hint: "[--replan se já existe PLAN.md]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
oxe_workflow_slug: plan-agent
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: a8f516ec17603d26
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
- **Checksum semântico:** `a8f516ec17603d26`
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

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/plan-agent.md ou oxe/workflows/plan-agent.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Se `$ARGUMENTS` contiver `--replan`, seguir a variante de replanejamento descrita no workflow.
