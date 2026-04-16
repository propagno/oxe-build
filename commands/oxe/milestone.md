---
name: oxe:milestone
description: "Marcos de entrega (M-NN) — new, complete (arquiva SPEC/PLAN/VERIFY em .oxe/milestones/M-NN/), status, audit"
argument-hint: "new <nome> | complete | status | audit"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: milestone
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: execution
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 1e1f50e7621c55dd
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** milestone
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** execução
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `1e1f50e7621c55dd`
- **Entrada de contexto prioritária:** `.oxe/context/packs/milestone.md` e `.oxe/context/packs/milestone.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow milestone --json`
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Seções esperadas:** Objetivo · Plano · Validação · Riscos · Assumptions · Confiança
- **Bloqueios formais:** missing:state · missing:spec
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/milestone.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Usa o texto em `$ARGUMENTS` como subcomando e contexto (ex.: `new sprint-1`, `complete`, `audit`).
