---
description: "OXE — Valida implementação (.oxe/VERIFY.md)"
argument-hint: "[opcional: Tn]"
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

OXE — Valida implementação (.oxe/VERIFY.md)

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

Executa o workflow **OXE verify**. Lê e aplica **integralmente**:

`.oxe/workflows/verify.md` (na raiz do repositório em contexto)

Se o utilizador indicar uma tarefa `Tn`, restringe a verificação a essa tarefa.
