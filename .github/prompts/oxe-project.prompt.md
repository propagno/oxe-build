---
name: oxe-project
agent: agent
description: OXE — Gestão de projeto unificada: milestone, workstream e checkpoint
argument-hint: "milestone new <nome> | workstream switch <nome> | checkpoint [slug]"
oxe_workflow_slug: project
oxe_reasoning_mode: planning
oxe_question_policy: ask_high_impact_only
oxe_output_contract: routing
oxe_tool_profile: mixed
oxe_confidence_policy: rubric
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 88b279f22bfd77ae
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** project
- **Modo:** planejamento
- **Perguntas:** perguntar só alto impacto
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** misto
- **Política de confiança:** rubrica
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `88b279f22bfd77ae`
- **Entrada de contexto prioritária:** `.oxe/context/packs/project.md` e `.oxe/context/packs/project.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow project --json`
- Fechar interfaces, validação, riscos, rollback e assumptions relevantes.
- Não deixar decisões importantes para quem implementar depois.
- Explicitar confiança e condição objetiva para replanejar.
- **Seções esperadas:** Objetivo · Plano · Validação · Riscos · Assumptions · Confiança
- **Bloqueios formais:** missing:state · missing:spec
- **Referência canónica:** `oxe/workflows/references/reasoning-planning.md`

<!-- oxe-reasoning-contract:end -->

Executa o workflow **OXE project** no repositório atual. Lê e aplica **integralmente**:

`.oxe/workflows/project.md`

`$ARGUMENTS` = subcomando: `milestone new|complete|status|audit`, `workstream new|switch|list|close <nome>`, `checkpoint [slug]`, ou vazio para status atual.
