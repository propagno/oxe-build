---
name: oxe-next
agent: agent
description: OXE — Próximo passo (lê STATE.md)
oxe_workflow_slug: next
oxe_reasoning_mode: status
oxe_question_policy: none
oxe_output_contract: routing
oxe_tool_profile: read_heavy
oxe_confidence_policy: explicit
oxe_context_tier: standard
oxe_contract_version: 2.0.0
oxe_semantics_hash: 5767434e94769645
---

<!-- oxe-reasoning-contract:start -->

**Contrato de raciocínio OXE deste comando**
- **Workflow:** next
- **Modo:** estado / roteamento
- **Perguntas:** nenhuma
- **Saída esperada:** roteamento
- **Perfil de ferramentas:** leitura intensa
- **Política de confiança:** explícita
- **Tier de contexto padrão:** padrão
- **Versão do contrato:** 2.0.0
- **Checksum semântico:** `5767434e94769645`
- **Entrada de contexto prioritária:** `.oxe/context/packs/next.md` e `.oxe/context/packs/next.json`
- **Regra pack-first:** ler o context pack primeiro; se estiver stale, incompleto ou ausente, cair para leitura direta com fallback explícito.
- **Inspeção estruturada:** `oxe-cc context inspect --workflow next --json`
- Responder com leitura curta e orientada a decisão.
- Dar uma recomendação única e justificar o motivo.
- Explicitar a confiança quando o estado estiver incompleto ou ambíguo.
- **Seções esperadas:** Leitura atual · Recomendação · Motivo · Confiança
- **Bloqueios formais:** missing:state
- **Referência canónica:** `oxe/workflows/references/reasoning-status.md`

<!-- oxe-reasoning-contract:end -->

<!-- oxe-workflow-resolution:start -->

**Resolução do workflow canónico:** a partir do CWD atual, subir diretórios até encontrar .oxe/core/workflows/next.md, .oxe/workflows/next.md ou oxe/workflows/next.md (nessa ordem). Ler e aplicar integralmente o primeiro ficheiro encontrado. No layout core (`.oxe/core/` existe), todo caminho `.oxe/workflows/…` ou `.oxe/templates/…` citado neste comando fica em `.oxe/core/workflows/…` / `.oxe/core/templates/…`. Não assumir que o CWD já é a raiz do repositório. Se nenhum existir (um worktree sem .oxe/, um repo sem a cópia dos workflows), rodar `oxe-cc workflow path next` (sem `oxe-cc` no PATH: `npx oxe-cc@<oxe_version de .oxe/oxe-version.json> workflow path next` — nunca o `npx oxe-cc` sem versão, que pega outra release): ele devolve o workflow do pacote oxe-cc instalado. Aplicar esse ficheiro e avisar uma vez: "este repositório não tem .oxe/workflows; para fixar a versão, rode oxe-cc install --oxe-only .". Só se o comando também falhar, reportar os paths tentados e parar.

<!-- oxe-workflow-resolution:end -->


