<!-- variante compacta de oxe/workflows/plan.md (OXB-132): gerada por scripts/build-compact-workflows.cjs. Em dúvida, leia a completa. -->
# OXE — Workflow: plan
<objective>
Esses artefatos são obrigatórios para considerar o plano executável. Quando algo não se aplicar, marcar explicitamente `not_applicable`; nunca omitir o arquivo.
**PLAN.json, aceite congelado e programa por fases (obrigatório com runtime):** seguir `oxe/workflows/references/plan-json-acceptance-program.md` — gravar `PLAN.json` (schema `oxe/schemas/plan.schema.json`), **escrever os testes de aceite dos A\* antes da execução** em `acceptance_tests` (o executor não pode alterá-los; o verify reprova `acceptance_tampered`), planejar só a fase ativa do `PROGRAM.json` e passar em `oxe-cc plan lint` antes de declarar o plano pronto. **Declarar os `phase_gates` do repositório** (typecheck, lint, suíte de governança, CI): sem eles, o verify verde da fase não garante a CI verde (1.21, mesma referência).
</objective>
<execution_rational_artifacts>
## Artefatos racionais obrigatórios
### IMPLEMENTATION-PACK
- sequência mínima de implementação, rollback/contensão para risco high/critical e imports/dependências obrigatórias.
### REFERENCE-ANCHORS
### FIXTURE-PACK
- `FIXTURE-PACK` é obrigatório para tarefas mutáveis com parser/layout/integração/transformação/fila/migração/builder;
- o `IMPLEMENTATION-PACK` deve fechar seções obrigatórias da interface, comportamento por interação, estado persistido e modelo de conteúdo;
</execution_rational_artifacts>
<plan_iteration_contract>
## Contrato de iteração do plano
1. **Mesmo escopo e mesma spec, mas o usuário quer refinar o plano**:
2. **A estratégia técnica mudou** (arquitetura, tradeoff, sequencing, decisão de implementação, boundary entre componentes):
3. **O escopo mudou** (requisitos, critérios A*, prioridade, corte de entrega, aceite, roadmap):
4. **Regra de precedência**:
</plan_iteration_contract>
<context>
- Seguir `oxe/workflows/references/flow-robustness-contract.md` como contrato canónico de robustez. A ordem obrigatória é: ler artefatos, resolver sessão/paths, validar pré-condições, escrever o plano, autoavaliar o plano, registrar próximo passo único.
- Se o pack estiver stale, ausente ou incompleto, fazer fallback explícito para leitura direta e, quando viável, regenerar ou inspecionar o contexto com `oxe-cc context inspect --workflow plan --json`.
- Se a SPEC ou artefatos do projeto mencionarem **Azure explicitamente** (Azure Service Bus, Azure SQL, Azure Event Grid, az CLI, ARM, subscription Azure, ou `.oxe/cloud/azure/` existir no projeto), **antes de detalhar tarefas**: (1) verificar `auth-status.json` — se `login_active: false` ou `subscription_id` ausente, registrar como **pré-condição bloqueante** no PLAN.md e sugerir `oxe-cc azure status` / `oxe-cc azure auth login`; (2) verificar staleness do inventário via `inventory.synced_at` — se stale além de `inventory_max_age_hours`, sugerir `oxe-cc azure sync` antes de executar; (3) se `vpn_required: true` no config, registrar como restrição explícita nas tarefas de mutação Azure. O plano deve vincular tarefas a recursos existentes em INVENTORY.md, SERVICEBUS.md, EVENTGRID.md ou SQL.md, ou declarar explicitamente os recursos Azure a criar com `oxe-cc azure <domínio> plan`. **SQL genérico, bancos on-prem ou outras nuvens não acionam este bloco.**
</context>
<format_plan>
    - **Alternativas descartadas:** cite as das decisões da fase (`oxe-cc decision list` mostra cada uma com o motivo e quem recusou) em vez de reescrevê-las. Uma alternativa nova recusada neste plano entra na decisão: `oxe-cc decision add … --alt "texto::motivo[::por::link]"`. O `plan lint` avisa quando uma tarefa propõe uma alternativa já recusada.
**Faixas semânticas obrigatórias:**
**Entradas obrigatórias da confiança:**
| `XL` | > 1 dia, impacto arquitetural | **Gate: deve ser quebrada em sub-tarefas ou ter justificativa** |
**Contrato racional de densidade operacional:** plano com tarefa mutável ainda vaga (`...`, "ajustar onde necessário", "melhorar interface", "organizar conteúdo") não sustenta `Confiança > 90%`. Para passar do gate, o plano precisa fechar:
</format_plan>
<executor_node_contract>
## Contrato executor — mapeamento tarefa → GraphNode
### Campos do GraphNode que o plano deve alimentar
### Catálogo de `action_type`
**Regra:** tarefas de investigação/leitura devem usar `read_code` ou `collect_evidence`. Tarefas de codificação usam `generate_patch`. Nunca usar `custom` quando uma ação mais específica for suficiente — `custom` desativa otimizações de paralelismo.
### `mutation_scope` e idempotência no scheduler
1. Se a tarefa pode rodar em paralelo com outras (sem mutation_scope = idempotente = segura)
2. Quais arquivos o executor tem permissão de escrever
3. O escopo de rollback em caso de falha
- Tarefas que executam comandos com side effects (migrations, deploys): sempre em série, onda própria
### Verificar como critério executável pelo agente
Se o comando não for possível no agente (ex.: requer browser ou acesso manual), usar **Verificar → Manual:** com checklist de passos observáveis. Nunca deixar **Verificar** vazio em tarefa mutável.
</executor_node_contract>
<wave_design_patterns>
## Padrões de design de ondas
### Padrão 1: Foundation → Core → Integration → Validation
### Padrão 2: Migration-safe (mudanças de schema)
    Onda 3 — Gate + Execute:
    T5 — [GATE HUMANO: revisar migration antes de aplicar em staging]
### Padrão 3: Refactor incremental (sem quebrar o sistema)
### Padrão 4: Investigação → Gate → Execução
    Onda 2 — Gate humano:
    T4 — [GATE: revisar findings de T1-T3 antes de executar qualquer mutação]
### Regras universais de onda
1. **Sem dependência circular:** T2→T3→T2 é inválido; quebrar em sub-tarefas ou redesenhar.
2. **Onda não pode ter tarefas com mutation_scope em comum** — separar em ondas distintas.
3. **Gates humanos são tarefas explícitas:** aprovação humana = tarefa `T-GATE` que bloqueia a onda seguinte.
4. **Onda de validação sempre ao final:** o último grupo de tarefas deve incluir `run_tests` ou `run_lint`.
5. **Respeitar `plan_max_tasks_per_wave`** da config (default: ilimitado) — se configurado, dividir em mais ondas.
6. **Ondas sem tarefas são inválidas** — verificar que cada número de onda tem pelo menos uma tarefa (gate 4 do quality gate).
</wave_design_patterns>
<task_granularity_rubric>
## Rubrica de granularidade de tarefas
### O que define uma boa tarefa
### Tamanhos de referência
### Sinais de que uma tarefa deve ser quebrada (XL obrigatório)
**Quando a tarefa XL não pode ser quebrada:** exigir sub-tarefas Tn.1, Tn.2, … como bullets dentro da tarefa, ou justificativa explícita de por que não pode ser dividida. Sem sub-tarefas e sem justificativa = falha do quality gate (item 8).
### Tarefas de investigação (action_type: read_code / collect_evidence)
Tarefas de investigação são sempre `S` ou `M` — não escrevem código. Devem:
- Nunca bloquear ondas de execução sem um gate de revisão explícito antes
### Anti-padrões de granularidade
</task_granularity_rubric>
<plan_anti_patterns>
## Anti-padrões de planejamento
### Decisão adiada para a execução
**Solução:** tomar a decisão antes de finalizar o plano. Se a decisão for complexa, criar tarefa de `read_code` na Onda 1 + gate humano, ou executar `oxe:discuss` antes.
### Verificar escrito depois de Implementar
**Solução:** o campo **Verificar** deve preceder **Implementar** no texto. A pergunta é "como saberei que está pronto?" — a resposta define o target; **Implementar** é o caminho mínimo até esse target. (Ver também gate item 9.)
### Acoplamento de ondas desnecessário
### mutation_scope vazio em tarefa de escrita
### Confiança > 90% sem artefatos racionais íntegros
**Por quê é ruim:** confiança sem evidência é otimismo sem base — o quality gate item 19 falha explicitamente.
### Risco sem contenção
**Solução:** toda tarefa de risco `high`/`critical` deve ter contenção em **Implementar**: ex.: "fazer backup da tabela antes da migration", "manter endpoint legado por uma versão". Ver quality gate item 13.
### "Tarefa de revisão final" no plano
**Solução:** mover revisão manual para o fluxo `oxe:verify`. O plano termina com uma tarefa de `run_tests` ou `run_lint` determinística.
### Tarefa sem rastreabilidade de entrada
**Por quê é ruim:** o quality gate item 12 falha; a tarefa parece inventada sem evidência.
</plan_anti_patterns>
<plan_quality_gate>
Antes de finalizar a resposta ao utilizador, o agente **deve** percorrer este gate sobre o `PLAN.md` já escrito; se falhar, **corrigir o PLAN** na mesma sessão.
1. **Depende de:** em cada `### Tn`, apenas IDs `Tk` que existem no mesmo ficheiro, ou `—`.
2. **Ciclos:** não há cadeia circular óbvia (ex.: T2→T3→T2); se houver, quebrar dependência ou onda.
3. **Cobertura A*:** todos os IDs da tabela de critérios em `SPEC.md` do escopo resolvido aparecem em **Aceite vinculado:** de alguma tarefa, ou há nota explícita de **gap** no PLAN (fora de âmbito / adiado) por ID.
4. **Ondas:** cada número de **Onda:** usado tem pelo menos uma tarefa; sem ondas vazias.
5. **`plan_max_tasks_per_wave`:** se `.oxe/config.json` tiver valor **> 0**, contar tarefas por **Onda**; nenhuma onda excede o limite.
6. **UI-SPEC:** se existir `UI-SPEC.md` no escopo resolvido, toda tarefa cuja **Implementar** ou **Verificar** toque UI deve citar **secção § do UI-SPEC** ou path explícito.
7. **Fidelidade de decisões:** se existir `DISCUSS.md` com IDs **D-NN** no escopo resolvido, cada decisão com impacto técnico deve aparecer em **Decisão vinculada:** de alguma tarefa, ou ter nota explícita de gap. Sem cobertura para D-NN técnico = falha do gate.
8. **Complexidade XL:** toda tarefa com `Complexidade: XL` deve ter sub-tarefas explícitas (ex.: T3.1, T3.2 — como bullets dentro da tarefa) **ou** justificativa na tarefa explicando por que não pode ser quebrada. Tarefa XL sem sub-tarefas e sem justificativa = falha do gate.
9. **Test-first:** em toda tarefa, `Verificar` deve preceder `Implementar` no texto. Se a ordem estiver invertida, corrigir antes de finalizar.
10. **Autoavaliação presente:** o `PLAN.md` contém `## Autoavaliação do Plano`, `Melhor plano atual`, `Confiança`, rubrica completa, bloco `<confidence_vector>` coerente e `Condição para replanejar`.
11. **Calibração de execução:** se `Melhor plano atual: não`, se a autoavaliação estiver estruturalmente incompleta, ou se `Confiança <= limiar configurado`, o plano não pode recomendar execução direta; deve recomendar refino, discuss ou research.
12. **Rastreabilidade de evidência:** cada tarefa deve ter entrada observável de origem na SPEC, no codebase, em DISCUSS, OBS, RESEARCH ou LESSONS; tarefa sem evidência de entrada explícita = falha do gate.
13. **Mudanças de risco:** tarefas com risco relevante (migração, auth, schema, contrato público, segurança) devem incluir contenção, rollback, fallback ou verificação reforçada.
14. **Cobertura R-ID:** se `SPEC.md` contiver tabela de requisitos com IDs `R-NN` e status `v1`/`v2`, cada R-ID em escopo deve ter ao menos um critério A* mapeado em **Aceite vinculado:** de alguma tarefa — rastrear `R-NN → A* → Tn`. R-IDs com `v1`/`v2` sem nenhuma tarefa associada = falha do gate; documentar como gap explícito quando intencional (ex.: `<!-- R-03: adiado para próximo ciclo -->`).
15. **Contexto estruturado:** se houver pack do workflow `plan`, as lacunas e conflitos críticos do pack aparecem na autoavaliação do plano ou são explicitamente dados como resolvidos durante a leitura direta.
16. **Implementation contract:** toda tarefa mutável deve aparecer em `IMPLEMENTATION-PACK.json` com `exact_paths`, `symbols`, `contracts`, `write_set: "closed"`, `expected_checks` e `ready: true`. Path com `...`, símbolo indefinido ou contrato ausente = falha do gate. `mode` aceita só `mutating`, `docs_only`, `external` ou `not_applicable` (tarefa de validação sem escrita = `not_applicable`).
17. **Reference anchors:** toda referência `external-ref`, "copiar do predecessor", "usar layout X" ou equivalente deve aparecer em `REFERENCE-ANCHORS.md` com `status: resolved`. Âncora crítica em `missing|stale|conflicting` = falha do gate.
17a. **Visual anchors:** se a SPEC ou UI-SPEC depender de imagem/screenshot/mockup, todo requisito visual crítico deve ter `VISUAL-INPUTS` pronto e anchor visual `resolved`. `chat_attachment_only` sem extração textual suficiente = falha do gate.
18. **Fixture coverage:** toda tarefa de parser/layout/integração/transformação/fila/migração/builder deve ter fixture `ready` em `FIXTURE-PACK.json`, salvo `not_applicable` explicitamente justificado. Ausência de fixture em tarefa de risco = falha do gate.
19. **Confiança > 90 de verdade:** `Confiança > 90%` só é válida se `IMPLEMENTATION-PACK`, `REFERENCE-ANCHORS` e `FIXTURE-PACK` estiverem íntegros e sem `critical_gap` aberto. Caso contrário, reduzir a confiança para `<= 90%` e recomendar refino.
Se após correções estruturais persistir ambiguidade de produto: **uma** frase recomendando `oxe:discuss` ou `oxe:spec`.
Resumo obrigatório no chat: `Gate do plano: OK` ou `Gate do plano: corrigido (N problemas)`.
</plan_quality_gate>
<process>
1. Resolver `active_session` e ler `SPEC.md` do escopo correto (obrigatório). Se faltar, pedir **spec** primeiro.
1a. Se `PLAN.md` já existir no escopo resolvido:
1b. Resolver o context pack `plan` primeiro:
   - ler `.oxe/context/packs/plan.md|json` (ou `oxe-cc context inspect --workflow plan --json`);
1c. Com pack válido, ler primeiro o resumo do pack e os artefatos de `read_order`; só abrir outros artefatos quando faltarem evidências para fechar tarefas, riscos ou autoavaliação.
2. Se `.oxe/config.json` tiver `discuss_before_plan: true` e **não** existir `DISCUSS.md` no escopo resolvido com decisões fechadas, pedir **discuss** antes de planejar.
3. Se existir **`.oxe/NOTES.md`**, consumir ou explicitamente adiar cada bullet relevante (ver **context**).
4. Ler `.oxe/codebase/*.md` (incl. CONVENTIONS / CONCERNS) e inspecionar pontos de entrada se a spec exigir. Se o pack não bastar, expandir a leitura apenas para os artefatos adicionais necessários e registar essa expansão.
5. Escrever ou atualizar `PLAN.md` no escopo resolvido usando `oxe/templates/PLAN.template.md` como cabeçalho; **preservar** YAML inicial (`oxe_doc: plan`, `status`, `inputs`) se já existir e **atualizar** `updated:` (ISO); em **--replan** ou **replan implícito**, preencher a seção **Replanejamento** (data, motivo, lições de VERIFY/SUMMARY, tarefas removidas/alteradas).
5a. Gerar junto os artefatos racionais:
6. Definir ondas: onda 1 = tarefas sem dependência entre si; onda seguinte = dependentes; respeitar `plan_max_tasks_per_wave` se configurado.
6a. **Calibração histórica:** se `.oxe/calibration.json` existir e tiver ≥ 2 registros, ler as últimas 3 entradas antes de preencher a autoavaliação. Para cada dimensão com `calibration_error > 0.25` em 2+ ciclos consecutivos, adicionar `[⚠ historicamente subestimado]` na nota da dimensão e reduzir o score em 0.10 ou justificar explicitamente por que o ciclo atual é diferente.
7. Preencher `## Autoavaliação do Plano` com a rubrica fixa. A confiança é a soma ponderada das seis dimensões; não inventar percentagem sem justificar os pontos. As lacunas, conflitos e freshness do pack devem aparecer nessa autoavaliação quando forem relevantes. **Incluir o bloco `<confidence_vector>`** com as 6 dimensões usando o template em `oxe/templates/PLAN.template.md`.
7b. Antes de declarar `Confiança > 90%`, validar os artefatos racionais:
7a. **Hipóteses Críticas:** ao criar tarefas `L` ou `XL` ou qualquer tarefa que dependa de lib externa, API de terceiros ou serviço de infra não testado ainda — adicionar seção `## Hipóteses Críticas` com pelo menos uma `<hypothesis>` por dependência crítica. Usar `oxe/templates/HYPOTHESES.template.md` como referência. Omitir a seção se todas as tarefas forem `S`/`M` e sem dependências externas não verificadas.
8. Aplicar integralmente o bloco **`<plan_quality_gate>`** acima ao `PLAN.md` em disco; corrigir o ficheiro até passar ou documentar gaps explícitos.
9. Atualizar `.oxe/STATE.md` global: fase `plan_ready`, próximo passo `oxe:execute` apenas se `Melhor plano atual: sim`, a autoavaliação estiver estruturalmente íntegra e a confiança superar o limiar executável; caso contrário, próximo passo deve reduzir incerteza (`oxe:discuss`, `oxe:research` ou replanejamento).
10. **Sugestão de agentes (inteligente):** após o gate passar, verificar se o plano tem 3+ domínios distintos (ex.: backend + frontend + DB, ou auth + notificações + UI). Se sim, sugerir proativamente: "Este plano tem N domínios distintos. Quer gerar um blueprint de agentes com `/oxe-plan --agents`?" — não executar automaticamente, apenas oferecer. Se o usuário incluiu `--agents` no input original, executar imediatamente a lógica de `oxe/workflows/plan-agent.md`.
11. Listar no chat: resultado do gate (OK ou corrigido), ondas, contagem de tarefas, comando de teste guarda-chuva se houver, melhor-plano-atual e confiança.
12. No resumo em chat, deixar explícitos:
</process>
<success_criteria>
- [ ] Cada R-ID `v1`/`v2` do SPEC tem ao menos um A* coberto por alguma tarefa, ou gap documentado (gate 14).
</success_criteria>
