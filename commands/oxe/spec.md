---
name: oxe:spec
description: >
  Conduz as 5 fases do processo de especificação: perguntas (blocos coesos por domínio), pesquisa
  (investigação de incertezas técnicas), requisitos (tabela R-ID com v1/v2/fora e critérios A*
  verificáveis), elevação de robustez (checklist de segurança por domínio AUTH/API/DB/FRONTEND/FILE),
  e aprovação com roteiro ROADMAP.md. Flags: --refresh (atualiza codebase/ antes), --full (scan
  completo), --research (Fase 2 explícita), --ui (gera UI-SPEC.md ao final).
argument-hint: "[descrição da feature | --refresh | --full | --research | --ui]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
oxe_workflow_slug: spec
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: eea8766eab635c97
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** spec
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `eea8766eab635c97`
- **Entrada de contexto prioritária:** `.oxe/context/packs/spec.md` e `.oxe/context/packs/spec.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow spec --json`
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Seções esperadas:** Fatos · Inferências · Lacunas · Próximo passo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/spec.md ou oxe/workflows/spec.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Usa `$ARGUMENTS` e o contexto da conversa como entrada do utilizador (texto ou `@ficheiro`).
