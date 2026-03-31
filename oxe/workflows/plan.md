# OXE — Workflow: plan

<objective>
Produzir **`.oxe/PLAN.md`**: tarefas **pequenas**, **ondas** (paralelizáveis vs sequenciais), e **cada tarefa com bloco de verificação** (comando de teste e/ou checklist manual).

Base: `.oxe/SPEC.md` + `.oxe/codebase/*` + código quando necessário (Grep/Read pontual).

Se o utilizador pedir **--replan** (ou replanejamento implícito após `verify_failed`):
- Ler **`.oxe/VERIFY.md`** (gaps e falhas), **`.oxe/SUMMARY.md`** se existir, e o **PLAN.md** atual.
- Preservar tarefas já concluídas ou renumerar com nota no **Replanejamento**; não apagar histórico útil do ficheiro — deslocar para a secção **Replanejamento** e reescrever a secção **Tarefas** conforme necessário.
- Se **SUMMARY.md** não existir, criar a partir de `oxe/templates/SUMMARY.template.md` só para registar o contexto do replan (ou append se já existir).
</objective>

<context>
- Não inventar APIs inexistentes: cruzar com **STRUCTURE.md**, **INTEGRATIONS.md** e ficheiros reais; respeitar **CONCERNS.md** (evitar agravar dívida conhecida sem tarefa explícita).
- Se existir **`.oxe/DISCUSS.md`**, alinhar tarefas às decisões registadas.
- Se existir **`.oxe/config.json`** com `default_verify_command` não vazio, usar como fallback quando a SPEC não indicar comando.
- Tamanho alvo: cada tarefa cabe em **um** contexto de agente focado.
- Id das tarefas: `T1`, `T2`, … estáveis para referência em verify.
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
- **Aceite vinculado:** (números dos critérios na SPEC)
```
</format_plan>

<process>
1. Ler `.oxe/SPEC.md` (obrigatório). Se faltar, pedir **spec** primeiro.
2. Se `.oxe/config.json` tiver `discuss_before_plan: true` e **não** existir `.oxe/DISCUSS.md` com decisões fechadas, pedir **discuss** antes de planear.
3. Ler `.oxe/codebase/*.md` (incl. CONVENTIONS / CONCERNS) e inspecionar pontos de entrada se a spec exigir.
4. Escrever ou atualizar `.oxe/PLAN.md` usando `oxe/templates/PLAN.template.md` como cabeçalho; em **--replan**, preencher a secção **Replanejamento** (data, motivo, lições de VERIFY/SUMMARY, tarefas removidas/alteradas).
5. Definir ondas: onda 1 = tarefas sem dependência entre si; onda seguinte = dependentes.
6. Atualizar `.oxe/STATE.md`: fase `plan_ready`, próximo passo executar PLAN depois **verify** (ou **execute**).
7. Listar no chat: ondas, contagem de tarefas, comando de teste guarda-chuva se houver.
</process>

<success_criteria>
- [ ] Cada tarefa tem seção **Verificar** com comando ou checklist explícito.
- [ ] Dependências entre tarefas estão explícitas.
- [ ] Critérios da SPEC mapeados para tarefas ou marcados como gap.
</success_criteria>
