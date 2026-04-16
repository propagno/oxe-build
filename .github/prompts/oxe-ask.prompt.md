---
name: oxe-ask
agent: agent
description: "OXE — Perguntar pela situação atual com leitura robusta de STATE, sessão ativa e artefatos relevantes"
argument-hint: "[pergunta em texto livre]"
oxe_workflow_slug: ask
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: b3f89121879267f9
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** ask
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `b3f89121879267f9`
- **Entrada de contexto prioritária:** `.oxe/context/packs/ask.md` e `.oxe/context/packs/ask.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow ask --json`
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Seções esperadas:** Fatos · Inferências · Lacunas · Próximo passo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE ask** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`oxe/workflows/ask.md`

Usa o texto adicional desta mensagem como pergunta e foco.
