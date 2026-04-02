# OXE — Workflow: debug

<objective>
Orientar **investigação técnica** de um sintoma (teste a falhar, erro em runtime, flake, regressão) **durante** a execução de tarefas do `PLAN.md` ou passos do `QUICK.md`: ciclo **hipótese → experiência mínima → evidência → próximo passo**.

Diferente de **`verify`**, que audita **aceite** contra SPEC/PLAN. Depois de estabilizar com debug, a trilha continua com **`execute`** e, no fecho, **`verify`**.
</objective>

<context>
- Pré-requisito: sintoma reproduzível ou descrição clara (mensagem de erro, Tn em falha).
- Preferir ancorar ao identificador de tarefa **`Tn`** do `.oxe/PLAN.md` quando existir.
- Artefato: **`.oxe/DEBUG.md`** — ficheiro único com **sessões** datadas (append); não dispersar em vários ficheiros sem convenção.
</context>

<process>
1. Ler `.oxe/PLAN.md` e `.oxe/STATE.md`; se o foco for uma tarefa, localizar **Tn** e o bloco **Verificar**.
2. Registar em **`.oxe/DEBUG.md`** uma nova sessão:
   - **Data** / **Sintoma** (com stack ou comando que falhou).
   - **Hipóteses** (ordenadas por plausibilidade).
   - **Experiências** — o que foi tentado e resultado (uma linha cada).
   - **Evidência atual** — ficheiros, linhas, conclusão parcial.
   - **Próximo passo:** `execute` (continuar correção) | `discuss` (decisão técnica em grupo) | `spec` ou `plan` (requisito ambíguo ou impossível como escrito).
3. Se a causa for **requisito errado**, documentar em DEBUG e recomendar **`/oxe-spec`** ou **`/oxe-plan`** (e opcionalmente **`/oxe-discuss`**).
4. Resumo no chat em ≤8 linhas: hipótese principal e próximo comando OXE.
</process>

<success_criteria>
- [ ] `.oxe/DEBUG.md` contém sessão datada com sintoma e **Próximo passo** explícito.
- [ ] Quando aplicável, a sessão referencia **Tn** do PLAN.
- [ ] Não se confunde com verify: não se declara “entrega aprovada” só com debug.
</success_criteria>
