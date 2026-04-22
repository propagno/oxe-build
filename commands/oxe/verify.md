---
name: oxe:verify
description: "Valida e fecha o ciclo (retro automática). Flags: --gaps, --security, --ui, --pr, --diff, --skip-retro"
argument-hint: "[Tn | --gaps | --security | --ui | --pr | --diff branchA...branchB | --skip-retro]"
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
oxe_semantics_hash: 8b47625394eec62a
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
- **Checksum semântico:** `8b47625394eec62a`
- **Entrada de contexto prioritária:** `.oxe/context/packs/verify.md` e `.oxe/context/packs/verify.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow verify --json`
- Apresentar findings primeiro, ordenados por severidade e evidência.
- Separar bug, risco, regressão e lacuna de teste.
- Se não houver findings, declarar isso explicitamente e listar riscos residuais.
- **Seções esperadas:** Findings · Perguntas abertas · Riscos residuais · Resumo
- **Bloqueios formais:** missing:state
- **Caminho runtime padrão:** `oxe-cc runtime verify --dir <projeto>` → `oxe-cc runtime project --dir <projeto>`
- **Artefatos canónicos primários:** `.oxe/runs/<run_id>/verification-manifest.json` · `.oxe/runs/<run_id>/residual-risk-ledger.json` · `.oxe/runs/<run_id>/evidence-coverage.json` · `VERIFY.md projetado`
- **Fallback runtime:** Se runtime verify não estiver disponível, declarar fallback explícito para a verificação manual; se retornar partial, usar os gaps explícitos como backlog da revisão.
- **Referência canónica:** `oxe/workflows/references/reasoning-review.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/verify.md ou oxe/workflows/verify.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Se `$ARGUMENTS` indicar um id de tarefa (ex. `T2`), restringir a verificação a essa tarefa.
