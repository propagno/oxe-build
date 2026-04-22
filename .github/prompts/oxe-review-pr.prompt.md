---
name: oxe-review-pr
agent: agent
description: OXE — Revisão de PR (link GitHub, branches ou SHAs)
argument-hint: "URL ou refs: https://github.com/org/repo/pull/10 | main feature/foo"
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

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/review-pr.md ou oxe/workflows/review-pr.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

**Exemplos de entrada:** cola o URL da PR (`https://github.com/org/repo/pull/10`, com ou sem `/files`); ou `org/repo#10`; ou **base** e **head** (branches/tags/SHAs). Sem refs, o agente infere (ex.: `main` vs branch atual).
