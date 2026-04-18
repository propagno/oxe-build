---
name: oxe-validate-gaps
agent: agent
description: OXE — Gaps de cobertura pós-verify (VALIDATION-GAPS.md)
argument-hint: "[opcional: foco Tn ou A*]"
oxe_workflow_slug: validate-gaps
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 27d51ac144da4c1c
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
- **Checksum semântico:** `27d51ac144da4c1c`
- **Entrada de contexto prioritária:** `.oxe/context/packs/validate-gaps.md` e `.oxe/context/packs/validate-gaps.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow validate-gaps --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `.oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE validate-gaps** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/validate-gaps.md`

Requer `VERIFY.md` e `PLAN.md` já existentes. Texto adicional: foco opcional em tarefa **Tn** ou critério **A***.
