---
name: oxe:validate-gaps
description: "[DEPRECATED v1.1.0] Incorporado por /oxe-verify. Use: /oxe-verify --gaps"
argument-hint: "[opcional: Tn ou A*]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: validate-gaps
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 69e3f79ec51160e1
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** validate-gaps
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `69e3f79ec51160e1`
- **Entrada de contexto prioritária:** `.oxe/context/packs/validate-gaps.md` e `.oxe/context/packs/validate-gaps.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow validate-gaps --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/validate-gaps.md`

Execute integralmente esse ficheiro na raiz do repositório. Pré-requisito: `VERIFY.md` e `PLAN.md`. `$ARGUMENTS` = foco opcional.
