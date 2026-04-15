---
name: oxe:compact
description: OXE — refresh codebase vs repo + CODEBASE-DELTA + RESUME (rotina de projeto)
oxe_workflow_slug: compact
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: execution
oxe_tool_profile: mixed
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 05c86e61cfc45177
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** compact
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** execução
- **Perfil de ferramentas:** misto
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `05c86e61cfc45177`
- **Entrada de contexto prioritária:** `.oxe/context/packs/compact.md` e `.oxe/context/packs/compact.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow compact --json`
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Seções esperadas:** Fatos · Inferências · Lacunas · Próximo passo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

# OXE — compact

**Workflow canónico:** `oxe/workflows/compact.md`

Execute integralmente. Atualiza **`.oxe/codebase/*.md`**, **`.oxe/CODEBASE-DELTA.md`** e **`.oxe/RESUME.md`**. `$ARGUMENTS` = foco opcional (ex. módulo) ou notas para Decisões/Bloqueios no RESUME.
