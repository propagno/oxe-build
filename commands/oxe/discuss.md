---
name: oxe:discuss
description: >
  Conduz sessão estruturada de resolução de decisões técnicas antes do planejamento. Identifica
  trade-offs relevantes, apresenta alternativas com critérios objetivos, registra a decisão
  escolhida com motivo e impacto em DISCUSS.md como D-NN. Cada D-NN fechado aqui é vinculado a
  tarefas Tn no PLAN.md e verificado pelo Verificador após execução. Usar quando: `discuss_before_plan`
  está ativo no config, há decisão arquitetural aberta, ou o Arquiteto sinalizou bloqueio.
argument-hint: "[decisão a tomar | contexto do trade-off | D-NN a reabrir]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
oxe_workflow_slug: discuss
oxe_reasoning_mode: discovery
oxe_question_policy: explore_first
oxe_output_contract: situational
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 6994c2427094eff3
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** discuss
- **Modo:** descoberta
- **Perguntas:** explorar primeiro
- **Saída esperada:** situacional
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `6994c2427094eff3`
- **Entrada de contexto prioritária:** `.oxe/context/packs/discuss.md` e `.oxe/context/packs/discuss.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow discuss --json`
- Explorar o repositório e os artefatos antes de perguntar.
- Separar fatos confirmados, inferências e lacunas.
- Perguntar apenas ambiguidades que mudem a decisão ou o artefato final.
- **Seções esperadas:** Fatos · Inferências · Lacunas · Próximo passo
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-discovery.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/workflows/discuss.md ou oxe/workflows/discuss.md. Ler e aplicar integralmente o primeiro ficheiro encontrado. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->

Usa `$ARGUMENTS` como contexto ou respostas.
