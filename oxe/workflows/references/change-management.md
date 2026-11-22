# Referência — Mudanças no meio do caminho

Depois que a spec foi aprovada (`oxe-cc spec approve`), nada se edita à mão em SPEC, ROADMAP ou PROGRAM.json. Cada mudança passa por um comando que registra quem, por quê e o antes e depois em `program/changes.ndjson`.

## Qual comando

| Pedido do usuário | Comando |
|---|---|
| "muda o texto, a verificação ou o risco do A3" | `oxe-cc spec amend A3 --text "…" \| --append "…" \| --verify "…" \| --risk P1 --by <papel> --reason "…" [--additive]` |
| "precisamos de um critério novo" | `oxe-cc spec add criterion A<n> --text "…" --verify "…" [--risk P1] --by … --reason …` |
| "requisito novo" | `oxe-cc spec add requirement R<n> --text "…" [--criteria A<n>]` |
| "põe A8 na fase F2" (fase pendente, ou em planning sem tentativa executada) | `oxe-cc program phase edit F2 --add-acceptance A8 --by …` |
| "tira A5 da F2" | `oxe-cc program phase edit F2 --remove-acceptance A5` (sai também do plano atual) |
| "move A3 da F1 para a F4" | `oxe-cc program criterion move A3 --from F1 --to F4` |
| "a F6 foi reaberta só por liberar um teste" (nenhum defect/spec_gap depois do close) | `oxe-cc program phase restore-close F6 --from-history --by … --reason "…"` (`--dry-run` antes); nunca editar o PROGRAM.json |
| "fase nova entre F2 e F3" | `oxe-cc program phase add --after F2 --title "…" --acceptance A9,A10` (renumera só as fases não iniciadas) |
| fase já executando, ou fechada | CR: `oxe-cc runtime feedback …`. O próximo `/oxe-plan --replan` cobre o CR com teste de aceite. |
| decisão muda | `oxe-cc decision add --supersedes D-NN …` (o ADR antigo fica marcado como substituído) |
| defeito depois do deploy | `/oxe-ship --defect` (item no ALM + CR) |
| "tira T10/T11, outra fase faz" (plano com ou sem programa) | `oxe-cc plan task supersede T10,T11 --by-phase "…" --by … --reason … --dry-run`, depois sem `--dry-run` |
| "junta T44 na T59" | `oxe-cc plan task fold T44 --into T59 --cr CR-n --by … --reason …` |
| "a tarefa precisa de mais um arquivo" | `oxe-cc plan scope add Tn <arquivo…> --cr CR-n --by … --reason …` |
| "muda a onda / a dependência de Tn" | `oxe-cc plan task edit Tn --wave n --depends-on T1,T2 --by … --reason …` |
| "esse teste do verify é de tarefa posterior" | `oxe-cc plan verify prune --later-owned --dry-run --by … --reason …` |
| "pausa tudo" / "pode seguir" | `oxe-cc runtime pause --reason "…"` / `oxe-cc runtime resume` |
| "fecha a fase pelo CI, sem verify final" | `oxe-cc runtime ci --attach <run>`, depois `oxe-cc runtime program close --by-ci --by … --reason …` (ou `delivery.close: "ci"` no config, e o próximo passo guia) |

## Quando algo falhou

Rode `oxe-cc status` (ou `/oxe`). O próximo passo lê os estados de falha e dá o comando exato, por ordem de urgência:

1. run pausado → `runtime resume`;
2. checkpoint falho → `plan scope add` (escopo insuficiente), `runtime commit-task` (trabalho na árvore; `--together` quando outra tarefa divide o arquivo) ou `plan done --commit` (nada mudou);
3. CR `spec_gap` aberto sem emenda → `spec amend --cr`;
4. tarefa adiada → `runtime deferred retry`;
5. verify reprovado → o primeiro check vermelho e o comando para reproduzi-lo.

## Regras

- **Decisão proposta pelo agente** (no plano, no grill, num CR): `oxe-cc decision add … --proposed`. Mostre ao usuário a decisão, a alternativa e o motivo; só com o OK dele rode `oxe-cc decision confirm D-… --by <quem decidiu>`. O `plan lint` bloqueia tarefa que cita decisão só proposta. Nunca grave `--by usuário` (ou o papel de outra pessoa) por conta própria.
- **Um CR registra e para.** Com programa ou plano em andamento, o pedido de mudança vira os comandos da tabela acima (critério, requisito, fase, CR) e termina com o próximo passo do `oxe-cc status`. **Nunca implemente o código do CR nesta conversa**, fora de `/oxe-plan` → `/oxe-execute` → `/oxe-verify`: o teste de aceite do critério novo é congelado no plano antes do código, e é isso que o protege. Mesmo que o pedido diga "implemente", responda com o registro feito e o próximo passo. **Única exceção:** o defeito pequeno do `/oxe-ship --defect` (critério existente sem mudança de texto, poucos arquivos de uma fase, nenhum contrato público), que segue a via rápida do Passo X do `ship.md` — teste que reproduz vermelho primeiro, correção, `oxe-cc quick done --verify`.
- Antes de mudar, mostre ao usuário o impacto: os critérios, as histórias (US-n), as tarefas e as fases afetadas. Execute só com o OK.
- Uma mudança de comportamento que já estava aprovado tem dono: sempre `--by` e `--reason`.
- Depois da mudança:
  - rode `oxe-cc spec check`; se a SPEC mudou depois da aprovação, ela precisa ser aprovada de novo **pelo humano**: mostre o diff dos critérios e peça o OK. Só depois rode `oxe-cc spec approve --by <quem aprovou>`. Nunca rode o `spec approve` "em nome" do PO sem esse OK nesta conversa, mesmo que o pedido diga que o PO já aprovou a mudança: a aprovação da mudança não é a aprovação da SPEC emendada;
  - com ALM configurado, rode `oxe-cc alm push --apply` (cria só o que falta);
  - com plano em andamento, rode `oxe-cc plan lint`.
- Pedido grande ou ambíguo ("refaz o fluxo de pagamento"): volte ao grill do ramo afetado (`oxe-cc grill ask --branch flows …`) em vez de emendar o critério.
