---
name: oxe-scan
agent: agent
description: OXE — Scan do repositório (.oxe/codebase/)
argument-hint: "[área opcional, ex. api]"
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

Executa o workflow **OXE scan** no repositório atual. Lê e aplica **integralmente** o ficheiro:

`oxe/workflows/scan.md` (na raiz do repositório em contexto)

Usa o texto adicional desta mensagem como foco opcional de área (pastas/módulos).
