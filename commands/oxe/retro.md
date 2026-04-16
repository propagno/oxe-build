---
name: oxe:retro
description: OXE — Retrospectiva de ciclo: sintetiza lições prescritivas em .oxe/LESSONS.md (alimenta ciclos futuros automaticamente)
argument-hint: "[opcional: contexto sobre o ciclo]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: retro
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 5afa357495cad615
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** retro
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `5afa357495cad615`
- **Entrada de contexto prioritária:** `.oxe/context/packs/retro.md` e `.oxe/context/packs/retro.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow retro --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canônico:** `oxe/workflows/retro.md`

Execute integralmente esse ficheiro. Lê VERIFY.md, FORENSICS.md, SUMMARY.md para sintetizar 3–5 lições prescritivas. `$ARGUMENTS` = contexto extra opcional.
