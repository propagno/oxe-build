---
name: oxe-research
agent: agent
description: OXE — Pesquisa exploratória (.oxe/research/ + índice RESEARCH.md)
argument-hint: "[âmbito, ex. módulo auth, mapa sistema, reversa]"
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

Executa o workflow **OXE research** no repositório atual. Lê e aplica **integralmente**:

`oxe/workflows/research.md`

Usa o texto adicional desta mensagem como âmbito (paths, perguntas, spike, mapa de sistema, engenharia reversa ou modernização).
