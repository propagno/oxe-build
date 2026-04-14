---
name: oxe:research
description: OXE — Pesquisa exploratória (notas datadas em .oxe/research/ + RESEARCH.md)
argument-hint: "[âmbito: spike, mapa sistema, reversa, modernização, …]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

**Workflow canónico:** `oxe/workflows/research.md`

Execute integralmente esse ficheiro na raiz do repositório. Usa `$ARGUMENTS` como âmbito e perguntas.
