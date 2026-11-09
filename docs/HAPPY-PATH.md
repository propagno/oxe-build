# Caminho feliz do OXE (1.21.2)

Guia curto para quem usa só a trilha recomendada. O detalhe de cada passo está em `oxe/workflows/<passo>.md` e em [WALKTHROUGH.md](WALKTHROUGH.md).

## Uma feature, do zero ao close

| # | Você roda | O que sai | Pare aqui se… |
|---|---|---|---|
| 1 | `/oxe` | onde você está e o próximo passo | — |
| 2 | `/oxe-spec` | SPEC.md (critérios A\* com a coluna **Risco**), ROADMAP.md | algum critério não tem como verificar |
| 3 | `oxe-cc spec probe` | bordas e proibições por critério | uma proibição "julgamento" ficou sem dono |
| 4 | `/oxe-plan` | PLAN.json + PLAN.md + IMPLEMENTATION-PACK.json, com os testes de aceite congelados | — |
| 5 | `oxe-cc plan lint` | erros (bloqueiam) e avisos | há qualquer erro |
| 6 | `/oxe-execute` (`oxe-cc runtime execute`) | uma tarefa por vez, com verify e checkpoint commit | aparece **ATENÇÃO** no `oxe-cc status` |
| 7 | `/oxe-verify` (`oxe-cc runtime verify`) | VERIFY.md, os gates do projeto e a regressão das fases fechadas | há um gate vermelho (vira CR sozinho) |
| 8 | `oxe-cc program close` | dossiê da fase e a decisão PASS / CONCERNS / FAIL | o close lista motivos (todos são acionáveis) |

## Quando a execução para

A execução nunca para calada. O `oxe-cc status` mostra no topo o que precisa de alguém, e `.oxe/ATTENTION.md` tem o comando que resolve.

| Sinal | O que é | O que fazer |
|---|---|---|
| `paused_environment` | foi a máquina, não o código (ferramenta, rede, memória) | corrija e rode `oxe-cc runtime execute` de novo; nenhuma tentativa foi gasta |
| `paused_quota` | foi a cota do provedor | espere o reset e rode de novo |
| `turns_exhausted` | a tentativa acabou sem turnos | o retry já sobe o nível de turnos; para um teto fixo, use `execute.turns` ou `max_turns` na tarefa |
| `question_waiting:Q-n` | o executor perguntou e os artefatos não respondem (só com `execute.ask_orchestrator`) | `oxe-cc runtime questions answer Q-n --answer "…"` |
| tarefa adiada (`AD-…`) | a tarefa esgotou as tentativas; as independentes seguiram | `oxe-cc runtime deferred`, corrija e depois `runtime deferred retry` |
| `checkpoint_failed` | o verify passou, mas o commit da tarefa não fechou | a mensagem diz o caminho; nada fica pela metade sem aviso |
| `plan_stale:Tn` | o código mudou depois do plano | revise a tarefa e rode `oxe-cc plan refresh --tasks Tn` |

## O que já vem ligado

Está ligado por padrão:

- verify por tarefa com anti-stub;
- testes congelados e checkpoint por tarefa;
- adiamento da tarefa que não converge;
- turnos por tamanho da tarefa (S 15, M 30, L 60), com `runtime.provider.maxTurns` como teto;
- o retry diz o que a tentativa anterior deixou;
- o sinal de atenção;
- os lints de plano (decisões, proveniência da pesquisa, código copiado no pack, alternativa já recusada).

Os opt-ins ficam em `.oxe/config.json`:

- `execute.ask_orchestrator`: canal de pergunta;
- `execute.dispatch: "stream"`: dependentes começam sem esperar a onda;
- `execute.repair`: estratégia de reparo;
- `models.tiers`: sobe o modelo depois de falha de lógica;
- `program.risk_decision`: PASS / CONCERNS / FAIL;
- `ui_evidence`: pacote de prova de UI;
- `review` / `adversarial_verify`: revisão independente em processo separado, que é paga;
- `plan lint --read`: leitura do plano por processos sem contexto, também paga.

## Programa com várias fases

- `oxe-cc program init` e depois `oxe-cc program start F1` começam o programa.
- Cada fase repete os passos 4 a 8.
- A próxima fase recebe as interfaces congeladas e o handoff da anterior.
- `oxe-cc program queue` diz o próximo item de cada papel.
- `oxe-cc docs check` aponta documentos de fases fechadas que o código já desmentiu.

## Depois de atualizar o OXE

`oxe-cc doctor --migrate-config` mostra as notas desta versão para o seu config. Com `--apply`, aplica os movimentos mecânicos de chaves, depois de fazer backup.
