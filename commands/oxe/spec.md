---
name: oxe:spec
description: >
  Conduz as 5 fases do processo de especificação: grill (árvore de decisões, uma pergunta por vez com a
  resposta recomendada, até não sobrar ambiguidade; --fast para blocos), pesquisa
  (investigação de incertezas técnicas), requisitos (tabela R-ID com v1/v2/fora e critérios A*
  verificáveis), elevação de robustez (checklist de segurança por domínio AUTH/API/DB/FRONTEND/FILE),
  PRD, glossário, ADRs e RFC, spec check e aprovação com roteiro ROADMAP.md. Flags: --refresh (atualiza codebase/ antes), --full (scan
  completo), --research (Fase 2 explícita), --ui (gera UI-SPEC.md ao final).
argument-hint: "[descrição da feature | --refresh | --full | --research | --ui]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
oxe_workflow_slug: spec
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 4ec66ac1e704fdbf
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** spec
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `4ec66ac1e704fdbf`
- **Entrada de contexto prioritária:** `.oxe/context/packs/spec.md` e `.oxe/context/packs/spec.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow spec --json`
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Seções esperadas:** Fatos · Inferências · Lacunas · Próximo passo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Variante enxuta (ler isto antes de abrir qualquer workflow):** se `.oxe/config.json` tiver `"profile": "lean"` ou `"plan_ceremony": "lean"`, o workflow a aplicar é `lean/spec.md` (na mesma pasta de workflows; `oxe-cc workflow path spec` devolve o caminho certo). Leia e aplique só ele, sem abrir o `spec.md` completo.

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/core/workflows/spec.md, .oxe/workflows/spec.md ou oxe/workflows/spec.md (nessa ordem). Ler e aplicar integralmente o primeiro ficheiro encontrado. No layout core (`.oxe/core/` existe), todo caminho `.oxe/workflows/…` ou `.oxe/templates/…` citado neste comando fica em `.oxe/core/workflows/…` / `.oxe/core/templates/…`. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir (um worktree sem .oxe/, um repo sem a cópia dos workflows), rodar `oxe-cc workflow path spec` (sem `oxe-cc` no PATH: `npx oxe-cc@<oxe_version de .oxe/oxe-version.json> workflow path spec` — nunca o `npx oxe-cc` sem versão, que pega outra release): ele devolve o workflow do pacote oxe-cc instalado. Aplicar esse ficheiro e avisar uma vez: "este repositório não tem .oxe/workflows; para fixar a versão, rode oxe-cc install --oxe-only .". Só se o comando também falhar, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Usa `$ARGUMENTS`, contexto da conversa e anexos como entrada do utilizador. Se houver imagem, screenshot ou mockup e o runtime suportar visão, materializar a interpretação em `VISUAL-INPUTS`; se não suportar, declarar a limitação e não inventar detalhes visuais.
