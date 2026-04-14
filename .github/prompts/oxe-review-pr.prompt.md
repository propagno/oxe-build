---
name: oxe-review-pr
agent: agent
description: OXE — Revisão de PR (link GitHub, branches ou SHAs)
argument-hint: "URL ou refs: https://github.com/org/repo/pull/10 | main feature/foo"
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE review-pr**. Lê e aplica **integralmente**:

`oxe/workflows/review-pr.md` (na raiz do repositório em contexto)

**Exemplos de entrada:** cola o URL da PR (`https://github.com/org/repo/pull/10`, com ou sem `/files`); ou `org/repo#10`; ou **base** e **head** (branches/tags/SHAs). Sem refs, o agente infere (ex.: `main` vs branch atual).
