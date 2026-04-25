# OXE — Workflow: debug

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-execute`.
> Use: `/oxe-execute --debug` para ativar diagnóstico técnico explícito.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Orientar **investigação técnica** de um sintoma (teste a falhar, erro em runtime, flake, regressão) **durante** a execução de tarefas do `PLAN.md` ou passos do `QUICK.md`: ciclo **hipótese → experiência mínima → evidência → próximo passo**.

Diferente de **`verify`**, que audita **aceite** contra SPEC/PLAN. Depois de estabilizar com debug, a trilha continua com **`execute`** e, no fecho, **`verify`**.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-execution.md`. O debug deve partir de evidência real, testar hipóteses pequenas e fechar com próximo passo único.
- Pré-requisito: sintoma reproduzível ou descrição clara (mensagem de erro, Tn em falha).
- Preferir ancorar ao identificador de tarefa **`Tn`** do `PLAN.md` do escopo resolvido quando existir.
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, usar `.oxe/<active_session>/execution/DEBUG.md`; sem sessão ativa, usar `.oxe/DEBUG.md`.
- Artefato: **`DEBUG.md`** no escopo correto — ficheiro único com **sessões** datadas (append); não dispersar em vários ficheiros sem convenção.
- Agente especializado: quando disponível, usar `oxe-debugger` para conduzir hipótese, reprodução mínima, evidência, eliminados e handoff retomável. O agente não deve declarar entrega aprovada; após correção, a trilha volta para `execute` e depois `verify`.
</context>

<process>
1. Ler `PLAN.md` do escopo resolvido e `.oxe/STATE.md`; se o foco for uma tarefa, localizar **Tn** e o bloco **Verificar**.
2. Registar em **`DEBUG.md`** do escopo resolvido uma nova sessão:
   - **Data** / **Sintoma** (com stack ou comando que falhou).
   - **Hipóteses** (ordenadas por plausibilidade).
   - **Experiências** — o que foi tentado e resultado (uma linha cada).
   - **Eliminados** — hipóteses descartadas e evidência.
   - **Evidência atual** — ficheiros, linhas, conclusão parcial.
   - **Próximo passo:** `execute` (continuar correção) | `discuss` (decisão técnica em grupo) | `spec` ou `plan` (requisito ambíguo ou impossível como escrito).
3. Se a causa for **requisito errado**, documentar em DEBUG e recomendar **`/oxe-spec`** ou **`/oxe-plan`** (e opcionalmente **`/oxe-discuss`**).
4. Resumo no chat em ≤8 linhas, nesta ordem:
   - **Contexto lido**
   - **Hipótese principal**
   - **Evidência atual**
   - **Próximo passo**
</process>

<success_criteria>
- [ ] `DEBUG.md` no escopo correto contém sessão datada com sintoma e **Próximo passo** explícito.
- [ ] Quando aplicável, a sessão referencia **Tn** do PLAN.
- [ ] Não se confunde com verify: não se declara “entrega aprovada” só com debug.
</success_criteria>
