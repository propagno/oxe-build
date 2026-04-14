---
name: oxe-compact
mode: agent
description: OXE — refresh .oxe/codebase vs repo + CODEBASE-DELTA + RESUME
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

Executa o workflow **OXE compact** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/compact.md`

Atualiza os **sete** mapas em **`.oxe/codebase/`** (incremental ou bootstrap como scan), gera **`.oxe/CODEBASE-DELTA.md`** e **`.oxe/RESUME.md`**. Texto extra do utilizador: foco ou decisões/bloqueios a incluir no RESUME.
