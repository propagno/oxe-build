# OXE — Workflow: spec (enxuto)

Variante para `profile: "lean"` ou `plan_ceremony: "lean"` em `.oxe/config.json`. Substitui `oxe/workflows/spec.md` e `references/grill.md`: não leia os arquivos completos.

<objective>
Chegar a uma SPEC aprovada perguntando **só o que o material do usuário não responde**. O que o brief, a issue ou o código já dizem vira fato registrado com a fonte, sem pergunta. O que sobra de ambíguo é perguntado em **um bloco**, confirmado em **um playback** e aprovado **uma vez** pelo usuário.
</objective>

<context>
- O estado do grill é do CLI (`.oxe/grill/`). Numa sessão nova, `oxe-cc grill status` diz onde parou; continue dali.
- Ramos: `problem`, `personas`, `scope`, `flows`, `rules`, `edges`, `nfr`, `integrations`, `rollout`, `metrics`, `risks`. O tipo da demanda (`oxe-cc grill start --type feature|bugfix|refactor|infra|…`) define os obrigatórios.
- Aprovação e confirmação são do usuário. Nunca rode `oxe-cc spec approve`, `grill confirm` ou `decision confirm` sem o OK dele nesta conversa, e nunca grave o papel dele por conta própria.
- Use `oxe-cc`, nunca `npx oxe-cc`.
</context>

<process>
1. `oxe-cc grill start --type <tipo>` (se ainda não começou). Leia o material que o usuário deu (brief, issue, documento) e, se houver código, só o que a demanda toca.
2. **Fatos primeiro.** Para cada ramo, tudo o que o material responde vira fato, sem pergunta:
   `oxe-cc grill fact --branch <ramo> --text "…" --source "<arquivo>:<linha>"`.
   Contrato já fixado no material (rotas, códigos de erro, formatos) é fato: não pergunte de novo nem proponha alternativa.
3. **Cace a ambiguidade que custa caro.** Releia o material procurando só o que ele **não fecha** e que muda comportamento observável, contrato, dado persistido, permissão ou dinheiro. Confira um por um:
   - valor **padrão** de cada parâmetro opcional (filtro, paginação, flag);
   - **quem vê e quem pode** cada recurso e cada listagem, por papel;
   - limites **inclusivos ou exclusivos** (`<` ou `<=`), arredondamento e unidade;
   - **ordem** das validações quando duas falham juntas (qual erro sai);
   - operação **repetida ou concorrente** (segunda chamada, duas ao mesmo tempo);
   - o que acontece com dados **já existentes** quando a regra muda.
   Detalhe cosmético e decisão de implementação sem efeito observável não entram.
   **Como escolher a recomendada** (ela costuma ser aceita sem leitura, então errá-la custa caro):
   - siga a convenção do próprio material: se ele marca o padrão dos outros parâmetros ("padrão 20") e não marca o deste, o padrão é **ausente** (sem filtro, sem efeito), não o valor do exemplo;
   - cada papel tem de conseguir fazer o trabalho que o material lhe atribui com a chamada mais simples (quem aprova enxerga a fila sem parâmetro extra); a opção que esconde de um papel o que ele precisa ver não é a recomendada;
   - na dúvida entre duas leituras, a recomendada é a menos surpreendente para quem consome o contrato, e o `--why` cita o trecho do material que a sustenta e o que sustentaria a outra.
4. **Um bloco de perguntas.** Registre cada pergunta antes de mostrar (`oxe-cc grill ask --branch <ramo> --question "…" --options "A | B" --recommended "A" --why "…" --affects <critérios>`) e mande todas numa mensagem só, numeradas: a pergunta, o que ela decide, as opções com a consequência em uma linha, a **recomendada** com o porquê. O usuário responde `ok` (todas as recomendadas) ou número por número. Registre com `oxe-cc grill answer Q-n …` (`--decision` só quando houver trade-off real de produto ou arquitetura). No máximo duas rodadas; o que ficar sem resposta vira `oxe-cc grill defer Q-n --reason "…"` e entra na SPEC como suposição explícita. Sem ambiguidade nenhuma, pule este passo e diga isso.
5. **Um playback.** Uma mensagem com 2 a 4 linhas por ramo (os fatos vindos do material em uma linha, citando a seção; as decisões novas por extenso) e uma pergunta: "confirma?". Só depois do "sim" do usuário, numa mensagem dele: `oxe-cc grill confirm <ramo> --playback "<o resumo do ramo>"` para cada ramo (`--empty --reason "…"` no que não se aplica), `oxe-cc grill term …` para cada termo de negócio (ou `--none`) e `oxe-cc grill close`.
6. **Documentos, a partir do grill e sem inventar:**
   - `SPEC.md`: objetivo, escopo, requisitos `R-n` e a tabela **Critérios de aceite** (`ID | Critério | Risco | Como verificar`), um critério por comportamento verificável, com os valores do material; bordas e proibições; suposições (as perguntas adiadas). Critério que só uma pessoa confere (uso no navegador, aparência, UAT) fica **separado** do que um teste confere, com "Como verificar: manual" — ele pede o sign-off do usuário no fechamento da fase.
   - `ROADMAP.md`: fases com resultado demonstrável e os critérios de cada uma, **neste formato exato** (é o que o `program init` lê):

     ```markdown
     ## Fase 1 — Fundação

     **Requisitos:** R-1
     **Critérios de aceite:** A1, A2, A3
     **Escopo:** o resultado demonstrável da fase, em uma linha
     ```
   - ADR só das respostas `--decision`. Fato vindo do material não vira ADR.
   - Rode `oxe-cc spec check` e corrija o que ele acusar. Não escreva documento que ele não exija.
7. **Uma aprovação.** Mostre o resumo (número de critérios por fase, os P0, as suposições) e pergunte se aprova. Só com o OK explícito: `oxe-cc spec approve --by <quem aprovou>`. Em seguida, com mais de uma fase no ROADMAP: `oxe-cc runtime program init` e `oxe-cc runtime program start` (abre a fase 1). Se o `init` recusar o ROADMAP, corrija o formato e repita; não siga sem programa.
8. Responda em até 8 linhas e termine com o **Próximo passo** de `oxe-cc status --json`.
</process>

<success_criteria>
- [ ] Nenhuma pergunta sobre o que o material já responde; cada fato registrado com a fonte.
- [ ] As ambiguidades do passo 3 foram conferidas uma a uma; as que existiam foram perguntadas com a recomendada.
- [ ] Um playback confirmado pelo usuário e uma aprovação dada por ele; nada confirmado ou aprovado em nome dele.
- [ ] `oxe-cc grill close` e `oxe-cc spec check` sem pendências.
</success_criteria>
