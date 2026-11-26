# OXE — Workflow: plan (enxuto)

Variante para `profile: "lean"` ou `plan_ceremony: "lean"` em `.oxe/config.json`. Substitui `oxe/workflows/plan.md`: não leia o arquivo completo, as referências nem os templates dele.

<objective>
Planejar **uma fase** escrevendo só duas coisas: os **testes de aceite congelados** dos critérios da fase e **um arquivo de papel** com as tarefas. O `oxe-cc plan build` gera `PLAN.json`, `PLAN.md` e `IMPLEMENTATION-PACK.json` a partir dele, e o `oxe-cc plan lint` é o gate. Você não escreve PLAN.md, packs, âncoras, fixtures nem autoavaliação à mão.
</objective>

<context>
- Fonte da fase: `oxe-cc status --json` (fase ativa e critérios `A*` dela). Leia na SPEC só as linhas desses critérios e as decisões que eles citam.
- Fases fechadas: leia `.oxe/program/interfaces/<fase>.json` (o que já existe e como se chama). Não releia o plano, o verify nem o dossiê delas.
- Código: Grep e Read pontuais nos arquivos que a fase vai tocar. Nada de leitura ampla.
- Decisão que a SPEC não fecha e que muda o comportamento: `oxe-cc decision add … --proposed`, mostre ao usuário e pare até o OK dele (`oxe-cc decision confirm D-… --by <quem decidiu>`). Nunca confirme em nome dele. Decisão de implementação sem efeito observável não vira decisão.
- Use `oxe-cc`, nunca `npx oxe-cc`.
</context>

<process>
1. **Testes de aceite congelados.** Para cada critério da fase, escreva o teste antes de qualquer código de produto, na pasta de aceite do projeto (ex.: `test/acceptance/`):
   - um teste por critério, com o ID no título (`A12: …`); pela interface pública (HTTP, CLI, função exportada), nunca por detalhe interno;
   - afirme o comportamento que a SPEC escreve, com os valores dela; sem `skip`, sem asserção sempre verdadeira e sem aceitar dois resultados ("403 ou 404"): se a SPEC não fixa o valor, isso é decisão a propor ao usuário, não folga no teste;
   - sem tempo de parede (`p95`, `Date.now()` como limite): requisito de desempenho vai em `phase_gates`, não em teste congelado;
   - critério que cita um exemplo do grill (`Q-4.1b`): o teste dele executa esse caso, afirma o resultado escolhido e traz o ID no título (`A12: Q-4.1b …`); o `plan lint` reprova sem ele;
   - não escreva implementação descartável: o `plan lint` confere que o teste nasce vermelho pelo motivo certo e, nos critérios P0, o execute mede a força dele com `oxe-cc plan mutate`.
2. **Arquivo de papel** em `.oxe/plan/<Fn>.role.json`:

   ```json
   {
     "role": "fase",
     "tasks": [
       { "rid": "R1", "title": "Store em memória", "files": ["src/store.js"], "created": ["src/store.js"],
         "acceptance": ["A1", "A2"], "depends_on": [], "verify": { "commands": ["node --test test/acceptance/store.test.js"] } }
     ],
     "acceptance_tests": [
       { "criterion": "A1", "files": ["test/acceptance/store.test.js"], "command": "node --test test/acceptance/store.test.js",
         "proves": ["A1: save guarda e devolve o item com id"] }
     ]
   }
   ```

   - Tarefa: pequena o bastante para um commit; `files` é tudo o que ela pode alterar (`created` para o que nasce, `edited` para o que já existe, `deleted` para o que sai); `verify.commands` roda só os testes dela, nunca a suíte inteira; `depends_on` cita o `rid` de outra tarefa.
   - `"model_hint": "fast"` só em tarefa mecânica, de um ou dois arquivos, toda coberta por teste congelado; nas demais, omita o campo. Tarefa de dinheiro, permissão ou segurança nunca é `fast`.
   - Todo critério da fase aparece em `acceptance` de alguma tarefa e tem a sua entrada em `acceptance_tests`; `proves` repete o título exato do teste.
   - Arquivo de teste congelado não entra em `files` de tarefa.
3. `oxe-cc plan build --from .oxe/plan/<Fn>.role.json --force` — gera `PLAN.json`, `PLAN.md` e o pack. Erro aqui se corrige no arquivo de papel, nunca nos arquivos gerados.
4. `oxe-cc plan lint` até sair com 0. Ele confere cobertura dos critérios, dependências, ondas, escopo e que cada teste novo está vermelho pelo motivo certo. Não percorra checklist à mão; o que o lint não acusa não bloqueia.
5. Commite **só** os testes congelados: `git add <arquivos de teste>` e `git commit -m "test(acceptance): frozen tests <Fn>"`.
6. `oxe-cc runtime compile` (congela o hash dos testes; a partir daqui alterar um deles é `acceptance_tampered`).
7. Responda em até 8 linhas: tarefas e ondas, critérios cobertos, decisões pendentes de OK (se houver) e o **Próximo passo** de `oxe-cc status --json`.
</process>

<replan>
`--replan` (verify reprovado ou CR): leia só o check vermelho ou o CR (`oxe-cc runtime feedback list`). Emenda de teste congelado só com `oxe-cc plan amend-test <arquivo> --reason "<CR>"`. Acrescente ao arquivo de papel a tarefa de correção (e o teste que reproduz o defeito, vermelho primeiro, com `"resolves": ["CR-…"]`), rode o `plan build --force` e o `plan lint` de novo. Tarefas já `done` ficam como estão.
</replan>

<success_criteria>
- [ ] Um teste congelado por critério da fase, commitado antes do código, vermelho pelo motivo certo (`plan lint`).
- [ ] `PLAN.json`, `PLAN.md` e pack gerados pelo `plan build`; nenhum escrito à mão.
- [ ] `oxe-cc plan lint` com saída 0 e `oxe-cc runtime compile` feito.
- [ ] Nenhuma decisão confirmada sem o OK do usuário.
</success_criteria>
