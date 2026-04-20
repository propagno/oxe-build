---
description: "OXE — Scan do repositório (.oxe/codebase/)"
argument-hint: "[área opcional, ex. api]"
oxe_workflow_slug: scan
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: c7c6e28ef92595b1
---

OXE — Scan do repositório (.oxe/codebase/)

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** scan
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `c7c6e28ef92595b1`
- **Entrada de contexto prioritária:** `.oxe/context/packs/scan.md` e `.oxe/context/packs/scan.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow scan --json`
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Seções esperadas:** Fatos · Inferências · Lacunas · Próximo passo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE scan** no repositório atual. Lê e aplica **integralmente** o ficheiro:

`.oxe/workflows/scan.md` (na raiz do repositório em contexto)

Usa o texto adicional desta mensagem como foco opcional de área (pastas/módulos).
