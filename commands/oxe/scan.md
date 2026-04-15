---
name: oxe:scan
description: Escaneia o repositório e gera mapa em .oxe/codebase/ + STATE.md
argument-hint: "[área opcional, ex. auth, api]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: scan
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 899fe6bc3684fc6e
---

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
- **Checksum semântico:** `899fe6bc3684fc6e`
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

**Workflow canónico:** `oxe/workflows/scan.md`

Execute integralmente esse ficheiro na raiz do repositório em que estás a trabalhar. Se o utilizador passar texto em `$ARGUMENTS`, usa-o como **foco opcional** de área (pastas/módulos) no mapeamento.
