---
name: oxe:review-pr
description: "[DEPRECATED v1.1.0] Incorporado por /oxe-verify. Use: /oxe-verify --pr ou /oxe-verify --diff branchA...branchB"
argument-hint: "<URL do PR ou branch:base..head>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: review-pr
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 836780b0831671b7
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** review-pr
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `836780b0831671b7`
- **Entrada de contexto prioritária:** `.oxe/context/packs/review-pr.md` e `.oxe/context/packs/review-pr.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow review-pr --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canônico:** `oxe/workflows/review-pr.md`

Execute integralmente esse ficheiro. Recebe URL de PR do GitHub (`org/repo#N`) ou par de branches/SHAs. `$ARGUMENTS` = referência do diff.
