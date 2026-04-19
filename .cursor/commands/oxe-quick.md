---
description: "OXE — Modo rápido com Plan-Driven Dynamic Agents lean: objetivo → passos → agentes por domínio (opcional) → verificar"
argument-hint: "[objetivo em texto livre] [--agents para forçar PDDA]"
oxe_workflow_slug: quick
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: plan
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: e3eac1b1bc15a71b
---

OXE — Modo rápido com Plan-Driven Dynamic Agents lean: objetivo → passos → agentes por domínio (opcional) → verificar

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** quick
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** plano
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `e3eac1b1bc15a71b`
- **Entrada de contexto prioritária:** `.oxe/context/packs/quick.md` e `.oxe/context/packs/quick.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow quick --json`
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Seções esperadas:** Objetivo · Plano · Validação · Riscos · Assumptions · Confiança
- **Bloqueios formais:** missing:state · missing:spec
- **Referência canónica:** `.oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE quick** no repositório atual. Lê e aplica **integralmente** o ficheiro no workspace:

`.oxe/workflows/quick.md`

Usa o texto adicional desta mensagem como objetivo e contexto.
