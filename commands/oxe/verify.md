---
name: oxe:verify
description: Valida implementação contra SPEC e PLAN; produz checklist e gaps
argument-hint: "[Tn opcional — focar uma tarefa]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
oxe_workflow_slug: verify
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 442bb4594208d058
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** verify
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `442bb4594208d058`
- **Entrada de contexto prioritária:** `.oxe/context/packs/verify.md` e `.oxe/context/packs/verify.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow verify --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/verify.md`

Execute integralmente esse ficheiro. Se `$ARGUMENTS` indicar um id de tarefa (ex. `T2`), restringir a verificação a essa tarefa.
