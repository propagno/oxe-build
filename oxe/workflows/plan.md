# OXE — Workflow: plan

<objective>
Produzir **`.oxe/PLAN.md`**: tarefas **pequenas**, **ondas** (paralelizáveis vs sequenciais), e **cada tarefa com bloco de verificação** (comando de teste e/ou checklist manual).

Base: `.oxe/SPEC.md` (critérios com IDs **A1**, **A2**, …) + `.oxe/codebase/*` + código quando necessário (Grep/Read pontual).

Se o usuário pedir **--replan** (ou replanejamento implícito após `verify_failed`):
- Ler **`.oxe/VERIFY.md`** (gaps e falhas), **`.oxe/SUMMARY.md`** se existir, e o **PLAN.md** atual.
- Preservar tarefas já concluídas ou renumerar com nota em **Replanejamento**; não apagar histórico útil — deslocar para a seção **Replanejamento** e reescrever **Tarefas** conforme necessário.
- Se **SUMMARY.md** não existir, criar a partir de `oxe/templates/SUMMARY.template.md` para registrar o contexto do replan (ou dar append se já existir).
</objective>

<context>
- Se existir **`.oxe/OBSERVATIONS.md`** com entradas `pendente` de impacto `plan` ou `all`, incorporar nas tarefas relevantes antes de finalizar o plano (ajustar implementação, verificação ou escopo de Tn) e marcar essas entradas como `incorporada → plan (data)`.
- Não inventar APIs inexistentes: cruzar com **STRUCTURE.md**, **INTEGRATIONS.md** e arquivos reais; respeitar **CONCERNS.md** (evitar agravar dívida conhecida sem tarefa explícita).
- Se existir **`.oxe/NOTES.md`**, rever entradas em aberto: incorporar em tarefas (com **Aceite vinculado** quando aplicável) ou registar na secção **Replanejamento** / nota explícita *fora de âmbito desta trilha*.
- Se existir **`.oxe/UI-SPEC.md`**, as tarefas de UI devem referenciar secções do UI-SPEC no texto de **Implementação** ou **Verificar**.
- Se existir **`.oxe/DISCUSS.md`**, alinhar tarefas às decisões registradas. Referenciar IDs **D-NN** no campo **Decisão vinculada:** de cada tarefa impactada — se nenhuma decisão impactar a tarefa, omitir o campo. A rastreabilidade D-NN → Tn → verify é usada pela seção **Fidelidade de decisões** do verify.
- Se existir **`.oxe/RESEARCH.md`** e notas em **`.oxe/research/*.md`**, ler o índice e as notas cujo **Tema** cruza o âmbito do plano (ou as mais recentes relevantes). Se o índice marcar **Estado** pendente em tópico bloqueante, pedir nova sessão **research** ou **discuss**, ou registar **suposição explícita** no PLAN antes de ondas que dependam dessa decisão.
- Se existir **`.oxe/plan-agents.json`** (gerado por **`/oxe-plan-agent`**), um **--replan** ou renumerar tarefas deve **atualizar o JSON em conjunto** com o `PLAN.md` (cobertura `taskIds`, ondas e dependências entre agentes) — ver **`oxe/workflows/plan-agent.md`**. Preferir **`/oxe-plan-agent --replan`** para regerar **`runId`**, **`lifecycle`** (`pending_execute`) e alinhar **STATE.md**; se só **`/oxe-plan`** for usado, ou o JSON fica manualmente sincronizado, ou marcar no JSON `lifecycle.invalidatedBy: new_plan` até novo plan-agent.
- Se existirem **`.oxe/CODEBASE-DELTA.md`** e/ou **`.oxe/RESUME.md`** (tipicamente após **`/oxe-compact`**), ler **antes** de detalhar tarefas: o delta resume o que mudou nos mapas face ao código; o RESUME ancora fase e trilha OXE — **não** substituem SPEC nem os sete ficheiros em `codebase/`.
- Se existir **`.oxe/config.json`** com `default_verify_command` não vazio, usar como fallback quando a SPEC não indicar comando.
- Se existir **`plan_max_tasks_per_wave` > 0** na config, **não** colocar mais tarefas do que esse número na mesma **Onda**; dividir em mais ondas.
- Tamanho alvo: cada tarefa cabe em **um** contexto de agente focado.
- IDs das tarefas: `T1`, `T2`, … estáveis para referência no verify.
</context>

<format_plan>
Cada tarefa em PLAN.md deve seguir:

```markdown
### Tn — título curto
- **Arquivos prováveis:** `...`
- **Depende de:** Tk ou —
- **Onda:** 1 | 2 | …
- **Implementação:** 1–3 frases do que fazer.
- **Verificar:**
  - Comando: `...` (ex.: npm test, pytest, mvn test)
  - Manual: (opcional) passos breves
- **Aceite vinculado:** A1, A2 (IDs exatos da tabela de critérios da SPEC)
- **Decisão vinculada:** D-01, D-02 (IDs de `.oxe/DISCUSS.md` — omitir se não houver DISCUSS)
<!-- oxe-task: {"id":"Tn","wave":1,"type":"feature","files":[],"done":false} -->
```

**Projetos sem suíte de testes única (legado):** o bloco **Verificar** pode usar `Comando: —` e **Manual** com Grep, leitura de paths ou checklist — ver exemplos em **`oxe/workflows/references/legacy-brownfield.md`**. Todo critério **A*** da SPEC deve aparecer em **Aceite vinculado** de alguma tarefa ou como gap explícito.

**Comparativo host ↔ cliente (migração / paridade):** pode-se dedicar tarefas a produzir ou atualizar uma **matriz Markdown** (classificações: equivalente / implementação diferente / só host / só cliente) com colunas de artefactos reais no repo — ver secção *Molde de comparativo* em **`oxe/workflows/references/legacy-brownfield.md`**. Cada **Tn** deve manter **Aceite vinculado** aos **A*** que essa matriz satisfaz.
</format_plan>

<plan_quality_gate>
Antes de finalizar a resposta ao utilizador, o agente **deve** percorrer este gate sobre o `PLAN.md` já escrito; se falhar, **corrigir o PLAN** na mesma sessão.

1. **Depende de:** em cada `### Tn`, apenas IDs `Tk` que existem no mesmo ficheiro, ou `—`.
2. **Ciclos:** não há cadeia circular óbvia (ex.: T2→T3→T2); se houver, quebrar dependência ou onda.
3. **Cobertura A*:** todos os IDs da tabela de critérios em `.oxe/SPEC.md` aparecem em **Aceite vinculado:** de alguma tarefa, ou há nota explícita de **gap** no PLAN (fora de âmbito / adiado) por ID.
4. **Ondas:** cada número de **Onda:** usado tem pelo menos uma tarefa; sem ondas vazias.
5. **`plan_max_tasks_per_wave`:** se `.oxe/config.json` tiver valor **> 0**, contar tarefas por **Onda**; nenhuma onda excede o limite.
6. **UI-SPEC:** se existir `.oxe/UI-SPEC.md`, toda tarefa cuja **Implementação** ou **Verificar** toque UI (paths como `*.tsx`, `components/`, ou palavras-chave front, ou pedido explícito do utilizador) deve citar **secção § do UI-SPEC** ou path explícito.
7. **Fidelidade de decisões:** se existir `.oxe/DISCUSS.md` com IDs **D-NN**, cada decisão com impacto técnico deve aparecer em **Decisão vinculada:** de alguma tarefa, ou ter nota explícita de gap (fora do escopo desta entrega). Sem cobertura para D-NN técnico = falha do gate.

Se após correções estruturais persistir ambiguidade de produto: **uma** frase recomendando `oxe:discuss` ou `oxe:spec`.

Resumo obrigatório no chat: `Gate do plano: OK` ou `Gate do plano: corrigido (N problemas)`.
</plan_quality_gate>

<process>
1. Ler `.oxe/SPEC.md` (obrigatório). Se faltar, pedir **spec** primeiro.
2. Se `.oxe/config.json` tiver `discuss_before_plan: true` e **não** existir `.oxe/DISCUSS.md` com decisões fechadas, pedir **discuss** antes de planejar.
3. Se existir **`.oxe/NOTES.md`**, consumir ou explicitamente adiar cada bullet relevante (ver **context**).
4. Ler `.oxe/codebase/*.md` (incl. CONVENTIONS / CONCERNS) e inspecionar pontos de entrada se a spec exigir.
5. Escrever ou atualizar `.oxe/PLAN.md` usando `oxe/templates/PLAN.template.md` como cabeçalho; **preservar** YAML inicial (`oxe_doc: plan`, `status`, `inputs`) se já existir e **atualizar** `updated:` (ISO); em **--replan**, preencher a seção **Replanejamento** (data, motivo, lições de VERIFY/SUMMARY, tarefas removidas/alteradas).
6. Definir ondas: onda 1 = tarefas sem dependência entre si; onda seguinte = dependentes; respeitar `plan_max_tasks_per_wave` se configurado.
7. Aplicar integralmente o bloco **`<plan_quality_gate>`** acima ao `PLAN.md` em disco; corrigir o ficheiro até passar ou documentar gaps explícitos.
8. Atualizar `.oxe/STATE.md`: fase `plan_ready`, próximo passo `oxe:execute` (implementar ondas) e depois `oxe:verify`.
9. Listar no chat: resultado do gate (OK ou corrigido), ondas, contagem de tarefas, comando de teste guarda-chuva se houver.
</process>

<success_criteria>
- [ ] Cada tarefa tem seção **Verificar** com comando ou checklist explícito.
- [ ] Dependências entre tarefas estão explícitas.
- [ ] Cada critério da SPEC (IDs **A***) está mapeado em **Aceite vinculado** de alguma tarefa ou explicitamente marcado como gap no plano.
</success_criteria>
