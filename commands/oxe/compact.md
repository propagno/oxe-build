---
name: oxe:compact
description: OXE — refresh codebase vs repo + CODEBASE-DELTA + RESUME (rotina de projeto)
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: execution
oxe_tool_profile: mixed
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** execução
- **Perfil de ferramentas:** misto
- **Política de confiança:** explícita
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

# OXE — compact

**Workflow canónico:** `oxe/workflows/compact.md`

Execute integralmente. Atualiza **`.oxe/codebase/*.md`**, **`.oxe/CODEBASE-DELTA.md`** e **`.oxe/RESUME.md`**. `$ARGUMENTS` = foco opcional (ex. módulo) ou notas para Decisões/Bloqueios no RESUME.
