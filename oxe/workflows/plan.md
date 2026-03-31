# OXE — Workflow: plan

<objective>
Produzir **`.oxe/PLAN.md`**: tarefas **pequenas**, **ondas** (paralelizáveis vs sequenciais), e **cada tarefa com bloco de verificação** (comando de teste e/ou checklist manual).

Base: `.oxe/SPEC.md` + `.oxe/codebase/*` + código quando necessário (Grep/Read pontual).

Se o utilizador pedir **--replan**, incorporar lições de `.oxe/SUMMARY.md` ou notas sem apagar histórico útil — usar seção “Replanejamento”.
</objective>

<context>
- Não inventar APIs inexistentes: cruzar com STRUCTURE.md e ficheiros reais.
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
2. Ler `.oxe/codebase/*.md` e inspecionar pontos de entrada se a spec exigir.
3. Escrever `.oxe/PLAN.md` usando `oxe/templates/PLAN.template.md` como cabeçalho.
4. Definir ondas: onda 1 = tarefas sem dependência entre si; onda seguinte = dependentes.
5. Atualizar `.oxe/STATE.md`: fase `plan_ready`, próximo passo executar PLAN depois **verify**.
6. Listar no chat: ondas, contagem de tarefas, comando de teste guarda-chuva se houver.
</process>

<success_criteria>
- [ ] Cada tarefa tem seção **Verificar** com comando ou checklist explícito.
- [ ] Dependências entre tarefas estão explícitas.
- [ ] Critérios da SPEC mapeados para tarefas ou marcados como gap.
</success_criteria>
