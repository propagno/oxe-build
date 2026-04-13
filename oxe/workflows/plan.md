# OXE — Workflow: plan

<objective>
Produzir **`.oxe/PLAN.md`**: tarefas **pequenas**, **ondas** (paralelizáveis vs sequenciais), e **cada tarefa com bloco de verificação** (comando de teste e/ou checklist manual).

Base: `SPEC.md` do escopo resolvido da sessão (critérios com IDs **A1**, **A2**, …) + `.oxe/codebase/*` + código quando necessário (Grep/Read pontual).

Se o usuário pedir **--replan** (ou replanejamento implícito após `verify_failed`):
- Ler `VERIFY.md` e `SUMMARY.md` do escopo resolvido, e o `PLAN.md` atual.
- Preservar tarefas já concluídas ou renumerar com nota em **Replanejamento**; não apagar histórico útil — deslocar para a seção **Replanejamento** e reescrever **Tarefas** conforme necessário.
- Se **SUMMARY.md** não existir, criar a partir de `oxe/templates/SUMMARY.template.md` para registrar o contexto do replan (ou dar append se já existir).
</objective>

<context>
- Seguir `oxe/workflows/references/flow-robustness-contract.md` como contrato canónico de robustez. A ordem obrigatória é: ler artefatos, resolver sessão/paths, validar pré-condições, escrever o plano, autoavaliar o plano, registrar próximo passo único.
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, o plano vive em `.oxe/<active_session>/plan/` e lê a spec em `.oxe/<active_session>/spec/`.
- Quando existirem, ler `INVESTIGATIONS.md`, `RESEARCH.md`, `CAPABILITIES.md`, `memory/` do projeto e `CHECKPOINTS.md` para calibrar dependências, riscos, automações disponíveis e gates humanos necessários.
- Se a SPEC ou artefatos do projeto mencionarem **Azure explicitamente** (Azure Service Bus, Azure SQL, Azure Event Grid, az CLI, ARM, subscription Azure, ou `.oxe/cloud/azure/` existir no projeto), **antes de detalhar tarefas**: (1) verificar `auth-status.json` — se `login_active: false` ou `subscription_id` ausente, registrar como **pré-condição bloqueante** no PLAN.md e sugerir `oxe-cc azure status` / `oxe-cc azure auth login`; (2) verificar staleness do inventário via `inventory.synced_at` — se stale além de `inventory_max_age_hours`, sugerir `oxe-cc azure sync` antes de executar; (3) se `vpn_required: true` no config, registrar como restrição explícita nas tarefas de mutação Azure. O plano deve vincular tarefas a recursos existentes em INVENTORY.md, SERVICEBUS.md, EVENTGRID.md ou SQL.md, ou declarar explicitamente os recursos Azure a criar com `oxe-cc azure <domínio> plan`. **SQL genérico, bancos on-prem ou outras nuvens não acionam este bloco.**
- Se existir `OBSERVATIONS.md` do escopo resolvido com entradas `pendente` de impacto `plan` ou `all`, incorporar nas tarefas relevantes antes de finalizar o plano (ajustar implementação, verificação ou escopo de Tn) e marcar essas entradas como `incorporada → plan (data)`.
- Se existir **`.oxe/global/LESSONS.md`**, ler entradas com `Aplicar em: /oxe-plan` e `Status: ativo`. **Priorizar entradas com `Frequência >= 2` ou `Impacto: alto`** — aplicar como restrições explícitas no planejamento: ajuste de complexidade de tarefas, padrões de verificação, escolha de modo solo vs agentes. Lições com `Frequência: 1` e `Impacto: baixo` são contexto secundário. Registrar aplicações como comentário no PLAN.md: `<!-- lição C-NN aplicada: ... -->`.
- **LESSONS + OBS juntos:** se houver tanto LESSONS quanto OBS pendentes, LESSONS orientam o *como planejar* e OBS orientam o *o que incluir*. Não confundir os papéis.
- Não inventar APIs inexistentes: cruzar com **STRUCTURE.md**, **INTEGRATIONS.md** e arquivos reais; respeitar **CONCERNS.md** (evitar agravar dívida conhecida sem tarefa explícita).
- Se existir **`.oxe/NOTES.md`**, rever entradas em aberto: incorporar em tarefas (com **Aceite vinculado** quando aplicável) ou registar na secção **Replanejamento** / nota explícita *fora de âmbito desta trilha*. Se não existir e houver necessidade de registrar notas, criar a partir de `oxe/templates/NOTES.template.md`.
- Se existir `UI-SPEC.md` no escopo resolvido, as tarefas de UI devem referenciar secções do UI-SPEC no texto de **Implementação** ou **Verificar**.
- Se existir `DISCUSS.md` no escopo resolvido, alinhar tarefas às decisões registradas. Referenciar IDs **D-NN** no campo **Decisão vinculada:** de cada tarefa impactada — se nenhuma decisão impactar a tarefa, omitir o campo. A rastreabilidade D-NN → Tn → verify é usada pela seção **Fidelidade de decisões** do verify.
- Se existir `RESEARCH.md` e notas em `research/*.md` do escopo resolvido, ler o índice e as notas cujo **Tema** cruza o âmbito do plano (ou as mais recentes relevantes). Se o índice marcar **Estado** pendente em tópico bloqueante, pedir nova sessão **research** ou **discuss**, ou registar **suposição explícita** no PLAN antes de ondas que dependam dessa decisão.
- Se existir `plan-agents.json` no escopo resolvido (gerado por **`/oxe-plan-agent`**), um **--replan** ou renumerar tarefas deve **atualizar o JSON em conjunto** com o `PLAN.md` (cobertura `taskIds`, ondas e dependências entre agentes) — ver **`oxe/workflows/plan-agent.md`**. Preferir **`/oxe-plan-agent --replan`** para regerar **`runId`**, **`lifecycle`** (`pending_execute`) e alinhar **STATE.md**; se só **`/oxe-plan`** for usado, ou o JSON fica manualmente sincronizado, ou marcar no JSON `lifecycle.invalidatedBy: new_plan` até novo plan-agent.
- Se existirem **`.oxe/CODEBASE-DELTA.md`** e/ou **`.oxe/RESUME.md`** (tipicamente após **`/oxe-compact`**), ler **antes** de detalhar tarefas: o delta resume o que mudou nos mapas face ao código; o RESUME ancora fase e trilha OXE — **não** substituem SPEC nem os sete ficheiros em `codebase/`.
- Se existir **`.oxe/config.json`** com `default_verify_command` não vazio, usar como fallback quando a SPEC não indicar comando.
- Se existir **`plan_max_tasks_per_wave` > 0** na config, **não** colocar mais tarefas do que esse número na mesma **Onda**; dividir em mais ondas.
- Tamanho alvo: cada tarefa cabe em **um** contexto de agente focado.
- IDs das tarefas: `T1`, `T2`, … estáveis para referência no verify.
</context>

<format_plan>
Cada tarefa em PLAN.md deve seguir a ordem abaixo — **Verificar vem ANTES de Implementar** (test-first):

```markdown
### Tn — título curto
- **Arquivos prováveis:** `...`
- **Depende de:** Tk ou —
- **Onda:** 1 | 2 | …
- **Complexidade:** S | M | L | XL
- **Verificar:**
  - Comando: `...` (ex.: npm test, pytest, mvn test)
  - Manual: (opcional) passos breves
- **Implementar:** o mínimo para fazer a verificação acima passar (1–3 frases).
- **Aceite vinculado:** A1, A2 (IDs exatos da tabela de critérios da SPEC)
- **Decisão vinculada:** D-01, D-02 (IDs de `.oxe/DISCUSS.md` — omitir se não houver DISCUSS)
<!-- oxe-task: {"id":"Tn","wave":1,"type":"feature","files":[],"done":false,"complexity":"S"} -->
```

Depois do resumo e antes das tarefas, o `PLAN.md` deve conter também:

```markdown
## Autoavaliação do Plano
- **Melhor plano atual:** sim | não
- **Confiança:** 0–100%
- **Base da confiança:**
  - Completude dos requisitos: NN/25
  - Dependências conhecidas: NN/15
  - Risco técnico: NN/20
  - Impacto no código existente: NN/15
  - Clareza da validação / testes: NN/15
  - Lacunas externas / decisões pendentes: NN/10
- **Principais incertezas:** ...
- **Alternativas descartadas:** ...
- **Condição para replanejar:** ...
```

**Rubrica fixa de confiança (determinística):**
| Dimensão | Peso |
|----------|------|
| Completude dos requisitos | 25 |
| Dependências conhecidas | 15 |
| Risco técnico | 20 |
| Impacto no código existente | 15 |
| Clareza da validação / testes | 15 |
| Lacunas externas / decisões pendentes | 10 |

**Faixas semânticas obrigatórias:**
- `85–100%` → pronto para executar
- `70–84%` → executável com risco controlado
- `50–69%` → precisa refino antes de execução
- `<50%` → não executar

**Entradas obrigatórias da confiança:**
- usar as incertezas estruturadas da SPEC e as investigações concluídas como base direta da rubrica;
- se o plano depender de capability nativa, investigação ainda não feita ou checkpoint humano antes de side effect crítico, isso deve aparecer explicitamente em tarefas, riscos e autoavaliação.
- se o plano depender de mutação Azure, incluir checkpoint formal antes de `apply`, mencionar a capability Azure correspondente e ligar a evidência esperada em `.oxe/cloud/azure/operations/`.

**Escala de Complexidade:**
| Valor | Esforço estimado | Sinal de alerta |
|-------|-----------------|-----------------|
| `S` | < 30 min, 1–2 arquivos | — |
| `M` | < 2h, 2–5 arquivos | — |
| `L` | < 1 dia, múltiplos componentes | Verificar que Verificar é específico |
| `XL` | > 1 dia, impacto arquitetural | **Gate: deve ser quebrada em sub-tarefas ou ter justificativa** |

**Princípio test-first:** escreva o `Verificar` antes de escrever o `Implementar`. A pergunta é: "Como saberei que está pronto?" — a resposta define o target; `Implementar` é o caminho mínimo até esse target.

**Projetos sem suíte de testes única (legado):** o bloco **Verificar** pode usar `Comando: —` e **Manual** com Grep, leitura de paths ou checklist — ver exemplos em **`oxe/workflows/references/legacy-brownfield.md`**. Todo critério **A*** da SPEC deve aparecer em **Aceite vinculado** de alguma tarefa ou como gap explícito.

**Comparativo host ↔ cliente (migração / paridade):** pode-se dedicar tarefas a produzir ou atualizar uma **matriz Markdown** (classificações: equivalente / implementação diferente / só host / só cliente) com colunas de artefactos reais no repo — ver secção *Molde de comparativo* em **`oxe/workflows/references/legacy-brownfield.md`**. Cada **Tn** deve manter **Aceite vinculado** aos **A*** que essa matriz satisfaz.
</format_plan>

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
10. **Autoavaliação presente:** o `PLAN.md` contém `## Autoavaliação do Plano`, `Melhor plano atual`, `Confiança`, rubrica completa e `Condição para replanejar`.
11. **Calibração de execução:** se `Melhor plano atual: não` ou `Confiança < limiar configurado`, o plano não pode recomendar execução direta; deve recomendar refino, discuss ou research.
12. **Rastreabilidade de evidência:** cada tarefa deve ter entrada observável de origem na SPEC, no codebase, em DISCUSS, OBS, RESEARCH ou LESSONS; tarefa sem evidência de entrada explícita = falha do gate.
13. **Mudanças de risco:** tarefas com risco relevante (migração, auth, schema, contrato público, segurança) devem incluir contenção, rollback, fallback ou verificação reforçada.
14. **Cobertura R-ID:** se `SPEC.md` contiver tabela de requisitos com IDs `R-NN` e status `v1`/`v2`, cada R-ID em escopo deve ter ao menos um critério A* mapeado em **Aceite vinculado:** de alguma tarefa — rastrear `R-NN → A* → Tn`. R-IDs com `v1`/`v2` sem nenhuma tarefa associada = falha do gate; documentar como gap explícito quando intencional (ex.: `<!-- R-03: adiado para próximo ciclo -->`).

Se após correções estruturais persistir ambiguidade de produto: **uma** frase recomendando `oxe:discuss` ou `oxe:spec`.

Resumo obrigatório no chat: `Gate do plano: OK` ou `Gate do plano: corrigido (N problemas)`.
</plan_quality_gate>

<process>
1. Resolver `active_session` e ler `SPEC.md` do escopo correto (obrigatório). Se faltar, pedir **spec** primeiro.
2. Se `.oxe/config.json` tiver `discuss_before_plan: true` e **não** existir `DISCUSS.md` no escopo resolvido com decisões fechadas, pedir **discuss** antes de planejar.
3. Se existir **`.oxe/NOTES.md`**, consumir ou explicitamente adiar cada bullet relevante (ver **context**).
4. Ler `.oxe/codebase/*.md` (incl. CONVENTIONS / CONCERNS) e inspecionar pontos de entrada se a spec exigir.
5. Escrever ou atualizar `PLAN.md` no escopo resolvido usando `oxe/templates/PLAN.template.md` como cabeçalho; **preservar** YAML inicial (`oxe_doc: plan`, `status`, `inputs`) se já existir e **atualizar** `updated:` (ISO); em **--replan**, preencher a seção **Replanejamento** (data, motivo, lições de VERIFY/SUMMARY, tarefas removidas/alteradas).
6. Definir ondas: onda 1 = tarefas sem dependência entre si; onda seguinte = dependentes; respeitar `plan_max_tasks_per_wave` se configurado.
7. Preencher `## Autoavaliação do Plano` com a rubrica fixa. A confiança é a soma ponderada das seis dimensões; não inventar percentagem sem justificar os pontos.
8. Aplicar integralmente o bloco **`<plan_quality_gate>`** acima ao `PLAN.md` em disco; corrigir o ficheiro até passar ou documentar gaps explícitos.
9. Atualizar `.oxe/STATE.md` global: fase `plan_ready`, próximo passo `oxe:execute` apenas se `Melhor plano atual: sim` e a confiança estiver no limiar executável; caso contrário, próximo passo deve reduzir incerteza (`oxe:discuss`, `oxe:research` ou replanejamento).
10. **Sugestão de agentes (inteligente):** após o gate passar, verificar se o plano tem 3+ domínios distintos (ex.: backend + frontend + DB, ou auth + notificações + UI). Se sim, sugerir proativamente: "Este plano tem N domínios distintos. Quer gerar um blueprint de agentes com `/oxe-plan --agents`?" — não executar automaticamente, apenas oferecer. Se o usuário incluiu `--agents` no input original, executar imediatamente a lógica de `oxe/workflows/plan-agent.md`.
11. Listar no chat: resultado do gate (OK ou corrigido), ondas, contagem de tarefas, comando de teste guarda-chuva se houver, melhor-plano-atual e confiança.
</process>

<success_criteria>
- [ ] Cada tarefa tem seção **Verificar** com comando ou checklist explícito.
- [ ] Dependências entre tarefas estão explícitas.
- [ ] Cada critério da SPEC (IDs **A***) está mapeado em **Aceite vinculado** de alguma tarefa ou explicitamente marcado como gap no plano.
- [ ] Cada R-ID `v1`/`v2` do SPEC tem ao menos um A* coberto por alguma tarefa, ou gap documentado (gate 14).
</success_criteria>
