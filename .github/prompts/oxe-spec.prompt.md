---
name: oxe-spec
agent: agent
description: "OXE — Spec em 5 fases: perguntas → pesquisa → requisitos (R-ID v1/v2/fora) → roteiro (.oxe/ROADMAP.md) → aprovação → plan"
argument-hint: "[descrição da feature ou ideia]"
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

Executa o workflow **OXE spec**. Lê e aplica **integralmente**:

`oxe/workflows/spec.md` (na raiz do repositório em contexto)

Usa o resto desta mensagem e ficheiros anexados como entrada do utilizador.
