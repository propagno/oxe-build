# OXE — Workflow: execute (enxuto)

Variante para `profile: "lean"` ou `plan_ceremony: "lean"` em `.oxe/config.json`. Substitui `oxe/workflows/execute.md`: não leia o arquivo completo nem as referências dele.

<objective>
Levar a fase ativa do plano ao fechamento **numa sessão só**: implementar cada tarefa até o teste congelado dela ficar verde, commitar por tarefa pelo CLI e fechar a fase com `oxe-cc phase close`. Sem perguntar modo de execução, sem revalidar packs e sem escrever relatório à mão.
</objective>

<flags>
- `--phase <Fn>` (ou nenhum argumento, com programa): a fase inteira, do plano ao fechamento. Se a fase ativa ainda não tem plano (`oxe-cc status --json` aponta `plan`), aplique primeiro `lean/plan.md` nesta mesma sessão e siga sem parar — a menos que haja decisão à espera do OK do usuário.
- `T<n>`: só essa tarefa (passos 2 e 3), sem fechar a fase.
</flags>

<context>
- Fonte: `.oxe/PLAN.json` (tarefas, ondas, `files`, `verify.commands`) e os testes de aceite congelados que cada tarefa cita. Leia o código que a tarefa toca; nada de leitura ampla.
- **Teste de aceite congelado não se edita.** Se um deles estiver errado (contradiz a SPEC ou outro teste), pare e relate: a saída é `oxe-cc plan amend-test <arquivo> --reason "<CR>"`, com o OK do usuário. Nunca enfraqueça, pule ou reescreva um teste para passar.
- Fique dentro de `files` da tarefa. Precisa de um arquivo a mais (ex.: fix de CI ou cobertura): use `oxe-cc plan scope add T<n> <arquivo> --auto-cr --reason "<motivo>"` (atualiza `PLAN.json` + `IMPLEMENTATION-PACK.json` atomicamente e registra o CR auditável), em vez de editar os JSONs à mão, e diga isso no resumo.
- Saídas `--json` (`runtime verify --json`, `plan lint --json`, `status --json`) são compactas por padrão (`< 4 KB`) para preservar contexto; o relatório completo do verify fica gravado em `.oxe/runs/<run_id>/verify-full.json` e `--full` devolve o payload completo quando necessário.
- Loops automáticos (`1.23.0`): `agents.auto_lease` (padrão `true`) registra e libera leases em `<git-common-dir>/oxe/active-agents.json` durante `runtime execute`, `runtime commit-task` e `quick`; o preflight executa `reevaluate` contra a base (bloqueando só se `reevaluate.block_on_drift: true`); com `models.auto_route: true`, `createModelSelector` consome `suggested_model_hint` sem sobrescrever `override` ou `model_hint` explícito.
- Testes além dos congelados: só o que eles não cobrem (borda interna, erro de infraestrutura). Não duplique em teste de unidade o que o teste de aceite já afirma.
- Use `oxe-cc`, nunca `npx oxe-cc`. Sign-off e aprovação são do usuário: nunca rode `runtime signoff`, `spec approve` ou `decision confirm` em nome dele.
- Exceções também são do usuário: nunca passe `--accept-drift`, `--defer-signoff`, `--accept-unpromoted`, `--no-rollback-check`, `--allow-dirty` ou `--force` por conta própria. Se o `phase close` pedir uma delas, pare e mostre o motivo.
</context>

<process>
1. `oxe-cc status --json`: confirme a fase ativa e que o próximo passo é executar. Sem `PLAN.json` da fase, veja `--phase` acima.
2. Por onda, na ordem do `PLAN.json`, para cada tarefa sem `done`:
   1. implemente o mínimo que deixa verdes os testes de `verify.commands` da tarefa;
   2. rode `oxe-cc runtime commit-task T<n>` — ele roda o verify da tarefa, confere o escopo e os testes congelados, commita com `OXE-Task` e marca `done`. Vermelho: corrija e rode de novo (no máximo 3 voltas na mesma falha; depois pare e relate a falha com a saída).
   Tarefas da mesma onda com `files` disjuntos podem ir a subagentes em paralelo, um por tarefa, cada um com só a tarefa, os arquivos dela e o comando de verify; o commit continua sendo `oxe-cc runtime commit-task`, um por vez.
   Tarefa com `"model_hint": "fast"` no `PLAN.json`: entregue-a a um subagente no modelo mais rápido que o host oferece (o teste congelado é o alvo dele). Se ela voltar vermelha duas vezes, faça você mesmo, no modelo desta sessão.
3. Se a fase tem critério P0, rode `oxe-cc plan mutate <critérios P0>` antes de fechar. Saída 1 (o teste não detecta nada) ou 2 (não medido): pare e mostre ao usuário; teste congelado só muda por `plan amend-test`, com o OK dele.
   Com todas as tarefas `done` (e só com `--phase` ou sem argumento): `oxe-cc phase close`.
   - Saída 0: fase fechada.
   - Saída 2: só faltam sign-offs humanos. Liste-os e pare; depois do sign-off do usuário, `oxe-cc phase close` de novo.
   - Saída 1: corrija o que ele lista (regressão de fase anterior, gate do projeto) e rode de novo. Regressão vermelha é defeito do código novo, não do teste antigo.
4. Responda em até 8 linhas: tarefas e commits, resultado do `phase close` (checks, regressão), o que ficou para o humano e o **Próximo passo** de `oxe-cc status --json`.
</process>

<success_criteria>
- [ ] Cada tarefa com commit `OXE-Task` feito pelo `oxe-cc runtime commit-task`; nenhum teste congelado alterado.
- [ ] Fase fechada pelo `oxe-cc phase close`, ou parada com a lista do que falta do humano.
- [ ] Nada assinado ou aprovado em nome do usuário.
</success_criteria>
