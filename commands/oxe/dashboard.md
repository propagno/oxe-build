---
name: oxe:dashboard
description: "Visualizar o runtime operacional, ondas, checkpoints e sinais principais da trilha OXE"
argument-hint: "[foco opcional]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
oxe_workflow_slug: dashboard
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: ebb4473c14e5b080
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** dashboard
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `ebb4473c14e5b080`
- **Entrada de contexto prioritária:** `.oxe/context/packs/dashboard.md` e `.oxe/context/packs/dashboard.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow dashboard --json`
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Seções esperadas:** Leitura atual · Recomendação · Motivo · Confiança
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/dashboard.md ou oxe/workflows/dashboard.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Usa o texto em `$ARGUMENTS` como foco opcional.
