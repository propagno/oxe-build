# Caminho feliz do OXE (1.21.2)

Guia curto para quem usa só a trilha recomendada. O detalhe de cada passo está em `oxe/workflows/<passo>.md` e em [WALKTHROUGH.md](WALKTHROUGH.md).

## A jornada (SDLC), do zero ao deploy

Cada etapa termina com **um** próximo passo (`oxe-cc status --json`), e `oxe-cc status --journey` mostra o mapa abaixo com o que já foi feito.

| # | Etapa | Você roda | O que sai | Pare aqui se… |
|---|---|---|---|---|
| 0 | Preparar | `/oxe` | `.oxe/`, scan e o próximo passo | — |
| 1 | Descobrir | `/oxe-spec` | **grill**: uma pergunta por vez, cada uma com a resposta recomendada, até não sobrar ambiguidade (`.oxe/grill/GRILL.md`, retomável). Depois, SPEC (A* com **Risco** e **Como verificar**), ROADMAP, PRD (histórias US-n e métricas), GLOSSARY, decisões e ADRs, RFC em rascunho para P0/P1 | o `oxe-cc grill close` recusa (mostra o que falta) |
| 2 | Validar | `oxe-cc spec check` → `spec probe` → `spec approve --by <papel>` | rastreabilidade R→A→US, glossário, bordas e proibições, aprovação registrada | há erro no check |
| 3 | Programar | `/oxe` (`program start`) · `oxe-cc alm push --stories-only` | fases e, com ALM, épico e histórias no Jira ou no Azure DevOps | — |
| 4 | Decidir | `/oxe-discuss` · `/oxe-discuss --rfc` | DISCUSS, RFC aceito ou recusado → D-NN e ADR | a fase tem P0/P1 sem RFC decidido |
| 5 | Planejar | `/oxe-plan` · `oxe-cc plan lint` · `alm push --tasks-only` | PLAN.json com testes de aceite congelados; tarefas no ALM | o lint tem erro |
| 6 | Construir | `/oxe-execute` | uma tarefa por vez, com verify, checkpoint e a chave do ALM no commit | aparece **ATENÇÃO** no `oxe-cc status` |
| 7 | Verificar | `/oxe-verify` | VERIFY, gates, regressão; checks pesados no CI (`verify.remote`); sign-off e dossiê | há um gate vermelho (vira CR sozinho) |
| 8 | Entregar | `/oxe-ship` (`oxe-cc ship status`) | PR com a chave do ALM → CI e merge → deploy anexado → docs → `program close` | o CI está vermelho (não se faz merge) |
| 9 | Operar | `/oxe-ship --defect "…" --origin US-n` · `/oxe "muda o A3"` | defeito no ALM e CR; mudanças pela trilha (`references/change-management.md`) | — |

Para trabalho pequeno: `/oxe-quick`. Para uma spec rápida, sem o grill: `/oxe-spec --fast`. Sem `delivery.mode: "pr"`, a etapa 8 é o `program close` com commit local, como antes.

## Quando a execução para

A execução nunca para calada. O `oxe-cc status` mostra no topo o que precisa de alguém, e `.oxe/ATTENTION.md` tem o comando que resolve.

| Sinal | O que é | O que fazer |
|---|---|---|
| `paused_environment` | foi a máquina, não o código (ferramenta, rede, memória) | corrija e rode `oxe-cc runtime execute` de novo; nenhuma tentativa foi gasta |
| `paused_quota` | foi a cota do provedor; uma janela curta (até 5 min, com o tempo informado pelo provedor) é esperada sozinha, e só o resto pausa | espere o reset e rode de novo; nenhuma tentativa foi gasta e o código em progresso fica na árvore |
| tarefa `in_progress` com a árvore suja | o executor caiu no meio da tarefa (rede, cota, máquina) | `oxe-cc runtime resume` mostra o que ficou; depois `runtime resume continue` ou `runtime resume reset-task` |
| tarefa feita fora do executor | um subagente ou você implementou a tarefa à mão | `oxe-cc runtime commit-task Tn --by <quem>` fecha pelo mesmo crivo (escopo, testes congelados, anti-stub, verify) |
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

- `runtime.provider.name: "antigravity"` (ou `--adapter antigravity`): executa as tentativas com `agy -p` em vez de `claude -p`;
- `execute.failure_classes: { "quota": [...], "environment": [...] }`: padrões do projeto para o que pausa a run sem gastar tentativa. A saída do verify só é lida como cota por um padrão declarado aqui, porque um teste chamado "resets the form" ou um erro na linha 429 é lógica, não o provedor;
- `coupled_scope`: arquivos que entram no escopo junto com outros (`[{ "when": [...], "include": [...], "note": "…" }]`); `builtin_coupled_scope: false` desliga as regras embutidas;
- `integration_checks`: comandos rodados no `runtime sync` e antes do push do `promote` (`false` desliga; uma lista substitui os detectados);
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

## Documentos de produto e técnicos

- **PRD** (`.oxe/PRD.md`): o `/oxe-spec` escreve o problema, as personas, as métricas e as histórias de usuário (US-n), cada uma ligada aos critérios A* da SPEC. Confira com `oxe-cc prd lint`.
- **RFC** (`.oxe/rfc/`): antes do plano de uma fase com critério P0/P1, rode `oxe-cc rfc new --title "…"`. Com as perguntas respondidas, `oxe-cc rfc accept RFC-…` registra a decisão.
- **ADR** (`docs/adr/`): sai do registro de decisões (ver abaixo).
- **Publicação**: `oxe-cc docs publish` copia PRD, RFCs, ADRs e SYSTEM-DESIGN para `docs/`. Com `docs_publish: { "dir": "docs" }` no config, o close de cada fase faz o mesmo e inclui os documentos no commit da fase. O `program init` já cria o SYSTEM-DESIGN, para o gate de documento desatualizado valer desde a primeira fase.
- **Branch com PR aberto**: o `program close` fecha a fase sem commitar e avisa; use um branch separado, ou `--force-branch`.

## ALM (Jira / Azure DevOps)

Com `alm` no `.oxe/config.json` (ver `oxe/templates/CONFIG.md`):

1. Depois da spec: `oxe-cc alm push --stories-only --dry-run`, e sem `--dry-run` com o OK. Cria o épico e as histórias.
2. Depois do plano: `oxe-cc alm push --tasks-only`. Cria uma tarefa por tarefa do plano; rodar de novo não duplica.
3. Daí em diante a chave vai no branch, nos commits e no título do PR. Início de tarefa, PR, merge e deploy movem os itens sozinhos; `alm.track` limita isso ao que outra ferramenta não move.
4. Defeito depois do deploy: `oxe-cc alm defect --title "…" --origin US-3`.

Sem token, com o Jira ou o Azure DevOps ligados à sessão por MCP, use `alm.transport: "mcp"`. Os mesmos comandos põem as escritas numa fila. O agente a executa com as ferramentas MCP (`oxe-cc alm queue`) e confirma cada operação com `oxe-cc alm ack <id> --key <chave>`.

Sem ALM, nada muda no fluxo.

## Decisões e ADRs

- Uma decisão fechada vai para o registro: `oxe-cc decision add --title "…" --context "…" --consequences "…"`, ou `oxe-cc decision import` para trazer a tabela do DISCUSS.md com os mesmos IDs.
- Cada mudança no registro publica os ADRs em `docs/adr/`, versionados junto com o código. O texto escrito fora dos marcadores é preservado.
- Uma decisão com `--check "<comando>"` é conferida no verify de toda fase que a cita, e de novo pelo `oxe-cc docs check` depois que a fase fecha.
- Para mudar de ideia: `oxe-cc decision add … --supersedes D-…`. O `plan lint` avisa a tarefa que ainda cita a decisão antiga.

## Depois de atualizar o OXE

`oxe-cc doctor --migrate-config` mostra as notas desta versão para o seu config. Com `--apply`, aplica os movimentos mecânicos de chaves, depois de fazer backup.
