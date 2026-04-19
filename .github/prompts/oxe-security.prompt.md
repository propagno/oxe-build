---
name: oxe-security
agent: agent
description: OXE — Auditoria de segurança OWASP (.oxe/SECURITY.md): P0/P1/P2 vinculados ao stack
argument-hint: "[opcional: categoria OWASP, módulo ou arquivo de foco]"
oxe_workflow_slug: security
oxe_reasoning_mode: review
oxe_question_policy: none
oxe_output_contract: findings
oxe_tool_profile: review_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 27ebaddfc7191f76
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** security
- **Modo:** revisão
- **Perguntas:** nenhuma
- **Saída esperada:** achados
- **Perfil de ferramentas:** revisão intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `27ebaddfc7191f76`
- **Entrada de contexto prioritária:** `.oxe/context/packs/security.md` e `.oxe/context/packs/security.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow security --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE security** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/security.md`

Lê `.oxe/codebase/STACK.md` para determinar categorias OWASP aplicáveis. `$ARGUMENTS` = foco opcional.
