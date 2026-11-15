# Changelog — OXE CLI (`oxe-cc`)

Todas as versões seguem [Semantic Versioning](https://semver.org/). As mudanças mais recentes aparecem primeiro.

---

## [1.21.2] — 2026-11-11

Esta versão consolida o que o OXESpace 1.5.0 (F1–F7 e F10) cobrou do oxe-build, mais o roteiro de excelência e os backlogs de comparação aprovados pelo TECH LEAD. Cada item tem uma seção em `docs/oxespace-1.5/BACKLOG.md`, com a evidência e o teste que a reproduz (`tests/oxe-1212-*.test.cjs`). Para usar só a trilha recomendada, veja [docs/HAPPY-PATH.md](docs/HAPPY-PATH.md).

### Skeleton (`plan skeleton`) sem erro de sintaxe em TS/JS e checagem `checkStubSyntax`

- `oxe-plan-skeleton.cjs` preserva o corpo já declarado em `interface`/`class`, gera `export const X: T = undefined as unknown as T;` em TS (`export const X = undefined;` em JS), extrai o nome certo em funções genéricas (`parse<T>(`) e constantes sem duplicar símbolos, e expõe `checkStubSyntax(file, text)` (`vm.Script` / `node --check` em CJS/JS/MJS e `ts.transpileModule` só de sintaxe quando o projeto tem `typescript`, caindo para aviso sem `typescript`).
- `oxe-verify-dryrun.cjs` reconhece os stubs TS/JS gerados pelo skeleton (`Error: TODO T<n>` na saída e `throw new Error('TODO T<n>: …')` no corpo) como `missing_target`, e `oxe-stub-check.cjs` resolve `nameOf(signature)` no nível `exists` quando a entrada do pack traz só `signature`.

### Retomada automática do execute (G24, OXE-143)

- **Lease do execute:** todo `runtime execute` grava `EXECUTE-LEASE.json` com o pid, os argumentos sem segredo e o estado. Um fim limpo fecha o lease e Ctrl+C o fecha como `stopped`. Um reinício ou um kill o deixam aberto, e isso passa a ser visível: `runtime autoresume status` mostra o estado, a decisão e a próxima tarefa.
- **Retoma sozinho:**
  - `runtime execute --supervise` relança o execute que cai no meio do run (kill por memória);
  - `runtime autoresume install` põe `autoresume run` no logon: no Windows, um `.cmd` na pasta Inicializar, sem admin; nos outros sistemas, a linha `@reboot` impressa para o crontab.
- **Onde recomeça:** a retomada usa os mesmos argumentos e começa na próxima tarefa não concluída. As tarefas concluídas antes do corte já estão done no PLAN.json e não são pagas de novo.
- **Nunca retoma:**
  - uma fase pausada (`runtime pause`, pausa de cota ou de ambiente, checkpoint esperando aprovação);
  - um lease fechado ou `stopped`;
  - `autoresume.enabled: false`;
  - um laço de queda (`max_restarts` em `window_hours`);
  - memória abaixo de `min_free_mb`: padrão 2560, ou `parallel.min_free_mb` quando definido; espera até `wait_memory_minutes` e desiste dizendo por quê.
- **Eventos:** `AutoResumed` e `AutoResumeSkipped`.
- **Teste:** `tests/oxe-1212-autoresume.test.cjs`. O CA-1 é um reinício simulado num programa de teste: o execute é morto em T2 com SIGKILL e o `autoresume run` o retoma em T2 sem chamar o executor para T1.

### P0 da revisão externa: contenção de caminho e adapter http (15/11)

- **Contenção por links (P0-2):** o `resolveWithin` exige que o caminho REAL (links resolvidos) fique dentro da raiz real. Isso vale também para um arquivo novo, pelo ancestral existente mais próximo. O `isProtected` compara os caminhos reais. Antes, um caminho por uma junction ou por um symlink, como os de `node_modules` que o próprio runtime cria nas worktrees, escapava da pasta.
- **Eventos e argumentos (P0-2):**
  - `tool_call`, `tool_denied` e `tool_result` levam o número real da tentativa. Antes saíam com 0 fixo.
  - Argumentos que não são um objeto JSON válido viram `invalid_tool_arguments` explícito para o modelo. Antes viravam `{}` em silêncio.
- **Adapter http (P0-1):**
  - Todo status ≥ 400 é erro classificado: 429 e cota são `quota`, contexto longo é `context`, o resto é `env`. Vem com dica: credencial; endpoint inexistente, para usar `--adapter claude` ou um proxy OpenAI-compatível; erro transitório do provedor. Antes, um 401, 404 ou 500 terminava a tentativa como "sem chamada de ferramenta" em silêncio.
  - O `usage` do stream é lido (`stream_options.include_usage`). Um backend que recusa esse campo recebe uma chamada a mais, sem ele.
- **Revisão cruzada (15/11):**
  - Um link pendente (destino ainda inexistente) para fora do workspace é recusado. Antes, o `realPathOf` subia além dele e a escrita seguia o link para fora.
  - No Windows e no macOS, a contenção e o `isProtected` comparam sem diferenciar maiúsculas.
  - `glob` e `grep` não entram em links.
  - No adapter http:
    - recusa de política (`content_filter`, usage policy) é `policy`, sem retry;
    - 401, 403 e 404 são `environment` e pausam o run em vez de pagar outra tentativa;
    - os tokens (`input`, `output`, `reasoning`) vão para o `executor_usage`;
    - o preflight avisa quando o http aponta para api.anthropic.com.
  - Argumentos só com espaços valem `{}`, e o `invalid_tool_arguments` também emite `tool_result`.
  - O `readRunState` não perde o ACTIVE-RUN quando o run não tem `updated_at`.

### `state.json` separa os CRs de outras fases (OxeChat F3, 15/11)

- O status do run vem do mais recente entre o `ACTIVE-RUN.json` e o `runs/<id>.json`, pelo `updated_at`: status, cursor e onda. Antes, o `state.json` mostrava "planned" para o mesmo run que o `ACTIVE-RUN` dava como pausado.
- Sem `ACTIVE-RUN`, o ledger de orçamento (`oxe-run-x.budget.json`) nunca é lido como o run.
- `open_crs` lista os CRs abertos da fase ativa e os sem fase. Os de outra fase, como uma emenda de critério de uma fase pendente, vão para `open_crs_other_phases` ({ id, phase }) e nunca aparecem como do run ativo. Antes, os CR-F4-1 e CR-F4-2 apareceram no estado da F3.

### Recusa da política de uso não vira retry (OxeChat F3 T7, 15/11)

- **Recusa de política:** um "safeguards flagged" / "usage policy" do modelo passa a ser `failure_class: policy`. O scheduler bloqueia a tarefa sem nova tentativa automática, e a saída aponta o `--print-prompt` para achar o trecho que dispara a recusa.
- **Antes:** era lida como falha de ambiente e retentada com o mesmo prompt, que seria recusado de novo. Na T7 do OxeChat F3, a primeira tentativa custou US$ 5,02 até a recusa.

### Precheck: veredito parcial em arquivo (OxeSpace 15/11, OxeQuery polish)

- O precheck grava o veredito até ali em `.oxe/precheck-last.json` depois de **cada** entrada: `finished`, `done/total`, achados e detalhes. Também mostra uma linha de progresso por entrada (`precheck 3/20: A7 — ok`). Antes, 20 runs remotos (1 h) e o processo encerrado no fim não deixavam veredito nenhum.
- A linha inicial diz que um remote-verify roda 1 vez, mesmo com `--precheck-runs 2`, e onde fica o veredito parcial.
- Revisão cruzada:
  - O arquivo fica ao lado do PLAN.json da sessão.
  - O precheck padrão de um `plan lint` comum grava `precheck-auto-last.json`, sem sobrescrever o parcial de um `--precheck-tests` de uma hora.
  - A gravação é atômica (tmp + rename).
  - O cache das entradas já aprovadas é gravado mesmo quando o processo morre no meio.
  - Cada suíte também ganha uma linha de progresso.

### G38 com filtro do vitest; `plan task fold`; contratos antecipados (OxeSpace 15/11, OxeCode F6 T44)

- **G38 e o filtro do vitest:** o G38 lê cada argumento do verify como **filtro de substring** do vitest. `pu03-app-version.test.ts` também rodava o `pu03-app-version.test.tsx` da T59 (onda 33), e a T44 (onda 18) foi adiada depois de 3 tentativas. A mensagem nomeia o argumento que casa. Um comando estreitado por `-t`/`--testNamePattern` conta como rodando só os próprios casos. O G38 roda em todo `plan lint`, inclusive de plano já instalado.
- **`plan task fold T<a> --into T<b> --cr CR-n --by --reason`:**
  - move para a tarefa alvo os files, os critérios, os comandos de verify e o contrato do pack;
  - religa os dependentes ao alvo, e as entradas congeladas passam a nomeá-lo;
  - marca a tarefa original `merged_into` (done, nunca agendada) e fecha os adiamentos dela como `merged_into:T<b>`, então o close não a conta como adiamento aberto;
  - fica registrada em `changes.ndjson` e no evento `PlanTaskFolded`.
- **Contratos antecipados** (Antigravity):
  - o `plan lint` avisa sobre uma tarefa com arquivo gerado sem a fonte (nem nas dependências) e sem o teste do gerador no verify;
  - o `generated_files` entra nas regras do repositório do prompt;
  - o prompt da tarefa lista os `data-*`/`cmdk-*`/`aria-label` dos arquivos dela que algum teste lê, antes da tentativa 1.

### `report failure-cost`: conserto por causa, razão explícita, horas de verify (OxeSpace 15/11)

- O mapa `failure_cost.fixes` casa a causa como impressa e também pelas partes dela: "CR constraint (no_progress)" tenta `no_progress` e depois `constraint`, sem diferenciar maiúsculas. Cada causa mostra as chaves tentadas (`fix_keys`). Antes, todo "fix" saía null.
- `discarded_share_pct` e `discarded_ratio` (0..1) ao lado do `discarded_share`, que continua igual por compatibilidade.
- Uma parada depois de `VerificationStarted` é verify esperando a CI: vai para `verifying_hours`, separada das `stopped_hours`.
- Revisão cruzada de `generated_files`, aria e espelho de quick:
  - os leitores de `aria-label` precisam parecer uma consulta de nome acessível;
  - o texto da chave vem do locale do commit pai quando a chave sai junto;
  - uma regeneração depois de uma tarefa anterior mudar a fonte passa;
  - uma fonte fora dos files é `scope_insufficient`;
  - os registros de quick anteriores ao espelho entram nele uma vez (backfill);
  - o `**/` respeita a fronteira de diretório.

### Arquivo gerado e nomes acessíveis no checkpoint (OxeSpace 15/11, Celular F3 #856, OxeCode F5 T22)

- **`generated_files`:** `[{ file, source, test?, generator? }]`. Um commit que muda um arquivo gerado sem mudar as fontes dele desfaz o checkpoint (`generated_file`), com "edite a fonte e rode o gerador". Caso real: 14 strings escritas direto no `strings.xml`, e o teste do gerador reprovou primeiro no CI do PR.
- **Nomes acessíveis no check de DOM hooks:** um `aria-label` removido, estático ou por chave de i18n (`{ "locale": "…en….json" }` resolve a chave no texto), que some do produto e que o e2e lê por role + nome. Caso real: o `<nav>` "Primary navigation" e o botão "Clear search".
- **Revisão cruzada:**
  - Uma tarefa reprovada por `dom_hooks` ou `generated_file` não é re-commitada às cegas.
  - A tentativa que volta recebe o motivo do checkpoint desfeito no prompt.
  - CSS, docs e lockfiles não "mantêm" um hook.
  - O `phase_suites` só pega suítes reais: sem helpers, e2e ou `parked-*`. Os guards nunca são cortados pelo `max_files`, e o `path.join` conta como citar o arquivo.

### Verify da fase roda as suítes do repo que leem os arquivos dela (OxeSpace 15/11, OxeCode F5 → #854)

- **`verify.phase_suites`:** opcional. Liga um gate implícito `phase-suites`, que roda:
  - as suítes de aceite do repo (`include`, padrão `tests/acceptance/`) que importam um arquivo mudado pela fase ou o citam (um caminho de `readFileSync`, como o CSS do cr15);
  - os `guards` do repo, sempre (a guarda estática de classes CSS).
- **O caso real:** o verify da F5 passou 40/40, e o CI do PR reprovou três guardas que o verify nunca rodou.
- **e2e/axe:** um `phase_gate` com `remote-verify`.

### Marcação que os testes ainda leem (OxeSpace 15/11, OxeCode F6 T30 → #852)

- **O check:** no checkpoint, sem rodar e2e. Um atributo `data-*` ou `cmdk-*` que o commit **remove** da marcação, que some do produto inteiro e que ainda é lido por um arquivo de e2e ou de teste, desfaz o checkpoint (`dom_hooks`). Os atributos e os leitores são nomeados.
  - Um valor dinâmico (`data-value={`cmd-${id}`}`) é procurado pelo prefixo.
  - O `data-testid` também é procurado via `getByTestId`.
  - Um atributo mantido em outro componente, ou cujos leitores saem no mesmo commit, não conta.
- **O caso real:** a T30 trocou o CommandMenu pela paleta e tirou o `[cmdk-root]`/`[cmdk-item][data-value=cmd-…]` que uns 30 specs e2e liam. A quebra só apareceu no CI do PR.
- **Configuração:** `checkpoint_dom_hooks: "warn"` só avisa; `false` desliga.

### Registros de quick espelhados no git (OxeSpace 15/11, worktrees t30 e F5)

- **O problema:** registros sumiam do `.oxe/quick`, que não é versionado, de uma worktree (um `.oxe` recriado, uma pasta sincronizada). Depois disso, o `check-origin` recusava commits feitos pelo `quick commit`.
- **O espelho:** todo registro também é gravado em `<git-common-dir>/oxe/quick/`, compartilhado por todas as worktrees do repositório e nunca tocado por um checkout.
- **A leitura:** um registro ausente no local é lido do espelho e restaurado. O `quick list` e o `check-origin` enxergam os dois lugares.

### Quick sem registro, trailer presente (OxeSpace 15/11, #854)

- **O caso:** um commit feito por `quick commit` cujo registro local se perdeu. O commit é **anterior ao primeiro registro** que esta cópia guarda em `.oxe/quick`, e o id do quick não é posterior ao commit.
- **O status:** o `ship check-origin` dá a esse commit um status próprio e auditado, `quick_unrecorded` ("registro ausente, trailer presente"). Ele aparece em todo relatório (`quick sem registro: …`, `quick_unrecorded[]`). Antes, isso exigia uma isenção manual.
- **O que continua reprovando:** um commit depois do primeiro registro, um id datado depois do commit, ou a falta de qualquer registro de onde datar.
- **Revisão cruzada do merge das isenções:** num `sha` duplicado vence a entrada versionada (ou a do `--config`), e o `authored` do mesmo autor nos dois arquivos vira uma regra só, com a união dos paths.

### Isenção pontual não some atrás do `oxe.config.json` (OxeSpace 15/11, #854)

- O `origin` do `oxe.config.json` versionado substituía o bloco `exempt` inteiro do `.oxe/config.json`, e uma isenção pontual (`exempt.commits`) sumia sem aviso. As regras continuam vencendo chave a chave. As **listas** de isenção (`commits` por sha, `paths`, `authors`, `authored`) agora se juntam, e uma lista que nenhum lado declara mantém o padrão.

### Promote leva o teste re-congelado do escopo da tarefa (OxeSpace 15/11, OxeCode F6 T30)

- **O que entra:** o `runtime promote` também leva, como arquivos da ponta do programa, os testes nos `files` da tarefa que diferem da base. Isso inclui um teste re-congelado pelo quick de um CR (o u83 do CR-F6-5). Antes, o PR levava o u83 antigo da main, que o código da T30 deixa vermelho.
- **O que só é avisado:** um teste do verify que difere da base, mas não é da tarefa, não entra. O aviso o nomeia, com os commits que o mudaram, e fica em `not_carried_tests`.

### Gates: sem embrulho duplo; CR do gate de CI resolvido pelo run verde (OxeSpace 15/11, Celular F3)

- **`phase_gates_runner`:** um gate que já começa com o prefixo do runner, ou que roda o mesmo script dele (por exemplo `remote-verify -- node gradle152.mjs …`), não é embrulhado de novo. Antes, a CI rodava um caminho do Windows ("Cannot find module '/home/runner/…/C:/Users/…remote-verify.mjs'").
- **`runtime ci --attach` com run verde:** resolve os CRs `constraint` abertos da fase que nasceram dos gates `kind: ci`. A resolução fica registrada como `ci_attach`. Antes, o CR ficava aberto sem caminho: o `--no-amendment` vale só para spec_gap, e o close passava mesmo assim. Um run vermelho, ou um CR de outro gate, não muda.

### Teste que só fica verde com uma tarefa posterior (G38, OxeCode F6 T27)

- **O `plan lint` acusa um verify que roda um teste de aceite que só uma tarefa pendente posterior torna verde:** o teste fica fora do alcance naquele ponto da ordem. "Teste de aceite" aqui é a entrada congelada da tarefa dona, ou um arquivo `acceptance/` no escopo dela.
  - A tarefa dona roda na mesma onda ou depois, e não é dependência da tarefa que roda o teste.
  - O padrão segue `lint.suite_impact`, e a mensagem diz como sair: tirar o teste do verify, ou depender da tarefa dona.
  - Caso real: a T27 (onda 1) foi adiada depois de 3 tentativas (US$ 16,91) com o u83 da T30 (onda 3) no verify.
- O G30 deixa de pedir no verify uma suíte de aceite que é de uma tarefa posterior.
- **`runtime deferred retry [dir]`:** o "retry" virava a pasta do projeto ("Diretório não encontrado: …\\retry"), mesmo com `--dir`.

### "A confirmar" só como marcador (OxeSpace 15/11, OXE-274)

- O lint do refine e do intake, o needs-info, o grooming e o intake da SPEC contam "A confirmar" só como frase inteira, sem letra ou dígito colados; o "a" minúsculo entre palavras ("obrigando-o a confirmar a exclusão") é preposição, e `_A confirmar_` em itálico conta. Antes, "…, pa**ra confirmar** com segurança …" virava um item em aberto sem pergunta e reprovava o `alm intake`.

### Registro de regressão com o hash re-congelado (OxeSpace 15/11, OxeChat F3)

- **No `program close`:** o snapshot de regressão fixa cada teste congelado pelo conteúdo no fechamento, que é o que o gate acabou de aceitar. Antes copiava o hash da suíte compilada antes de um CR re-congelar o teste, e toda verificação posterior lia o teste re-congelado como `acceptance_tampered`. O hash anterior fica em `sha256_compiled`.
- **`program regression repin Fn --criteria A<n> --by <papel> --reason "…" [--dry-run]`:** re-fixa os testes congelados de um critério de uma fase **fechada** no arquivo commitado.
  - Recusa um arquivo com mudança não commitada ou não versionado, uma fase aberta e um critério sem teste. Quando recusa, nada é gravado.
  - Grava `repins[]` (quem, por quê, de → para) e o evento `RegressionRepinned`.

### Recusa de política: o gatilho provável e uma nova tentativa escolhida (OxeSpace 15/11, Celular F3 T9)

- A falha `policy` diz o que o turno anterior acrescentou ao prompt: ferramenta, caminho e tamanho de cada resultado. Isso vai no texto e em `executor_usage.policy_trigger_candidates`. Uma recusa na primeira requisição aponta o prompt inicial.
- **`runtime execute --retry-policy-once`:** cada tarefa ganha **uma** tentativa a mais depois de uma recusa de política, mesmo além do `max_retries`, e nunca uma segunda. É para um falso positivo do classificador, que já passou num retry simples (OxeChat F3 T7). O padrão continua sem retry automático.
  - Num execute posterior do mesmo run, a tentativa 1 de uma tarefa já recusada **é** essa tentativa extra; não ganha uma segunda.
  - A tentativa extra conta na cota de retries do run.
  - A tentativa recusada guarda o seu log (`attempts/<tarefa>-<n>.log`).

### `alm label --remove`; o refine tira o `needs-info` respondido (OxeSpace 15/11, OXE-189)

- **`alm label <chave> --remove <rótulo>[,<rótulo>]`:** tira rótulos do card. Pode vir junto com o `--add`; um rótulo nos dois é recusado. Um rótulo que o card não tem é informado, não é erro.
- **`alm refine apply` tira o `needs-info`:** quando o spec não tem mais nenhum "A confirmar" e o card ainda traz `needs-info`, o rótulo sai. Isso vale também com o spec inalterado. Antes, o apply só acrescentava o rótulo.

### `alm supersede` não fecha como "Lançado"; `alm version none`; lint sem fase ativa (OxeSpace 15/11)

- **`alm supersede` nunca escolhe um status de release:**
  - Num fluxo cujo único status done é o de release ("Lançado"), um card substituído pareceria entregue na 1.5.2. Agora a simulação explica isso, e o `--apply` recusa sem gravar nada.
  - `--close-to <status>` fecha num status nomeado, e `--no-close` só liga e comenta.
  - `alm doctor` lista os status done e avisa quando só há o de release.
- **`alm version <KEY> none`:** remove a versão de correção do card.
- **Refine e help do ALM (OXE-166 a 170):**
  - O lint de interface aceita como alvo aprovado um JSON em `src/design/targets/` e um link de artefato do claude.ai. Um card sem BRD declara "BRD: nenhum (função nova)".
  - `refine apply --keep-status` grava a spec sem mover o card.
  - Os CAs ainda sem critério da SPEC viram um aviso só, não um por CA.
  - O `alm --help` lista `summary`, `supersede`, `pending` e as formas novas do `version`.
  - A checagem "fechar sem entregar" do `alm doctor` é só informativa (`!`).
- **`plan lint` sem fase ativa:** com o plano escrito antes do `program start`, o campo `phase` do PLAN.json define a fase. Antes, o lint cobrava do plano novo as emendas de todas as fases fechadas.

### `spec freeze` escolhe a entrada pelo critério (OxeCode F4, CR-F4-6)

- Com `--criteria`, o freeze atualiza a entrada desse critério. Se o arquivo só aparece na entrada de outro critério, cria uma entrada nova, com o próprio `sha256` e `hashes`. Sem `--criteria`, vale a primeira entrada que lista o arquivo, como antes.
- Antes, o A17 e o A18 dividem o `oxe128-next-attention.test.tsx`, e um freeze com `--criteria A18` sobrescrevia a entrada do A17. O A18 ficava sem hash, e o lock não via mudança no arquivo para ele.

### Teste congelado testado antes da tentativa paga (G36 parte 2, G30b parte 2) e pausa sem FAIL

- **`plan lint --precheck-tests [--precheck-runs 2]`, FIRST para os testes de aceite:**
  - Numa worktree temporária no HEAD, com os testes congelados copiados da árvore de trabalho e os stubs do pack (`plan skeleton`), cada teste de aceite de tarefa pendente roda N vezes. São três achados:
    - **trava contra o stub** (`precheck_hang`, erro): act com fake timers, um await sem fim, um servidor que não fecha;
    - **resultado diferente entre execuções** (`precheck_flaky`, erro);
    - **passa sem a implementação** (`precheck_passes_on_stub`, aviso).
  - Um comando via `remote-verify` roda uma vez só, com teto padrão de 30 min, e o estouro é aviso (`precheck_timeout_remote`), nunca travamento. A fila da CI conta no tempo de relógio, e antes três testes do OxeChat sessions deram falso `precheck_hang` aos 120 s. `--precheck-timeout <s>` define o teto. Os stubs e os testes copiados ficam na worktree temporária, que é onde o `remote-verify` tira o snapshot (`git add -A` do toplevel).
  - O executor mata a árvore de processos no timeout. Um teste travado nunca fica vazado nem prende a worktree.
  - Ativo por padrão no `plan lint` quando há testes congelados novos ou alterados em tarefas pendentes (`--no-precheck` ou `lint.precheck: false` desligam): grava o hash LF aprovado em `precheck-cache.json` para não repetir sem mudança no arquivo e pula comandos `remote-verify` com aviso no modo padrão (`--precheck-tests` ignora o cache e inclui o remoto).
  - Antes, os três defeitos de teste do planner desta noite (T5, T6 e o CA-6 da T20) custaram cerca de US$ 50 em tentativas sobre código certo.
- **G30b parte 2:** com `--precheck-tests`, as suítes achadas pelo G30 rodam uma vez no HEAD. Já vermelha ou travada antes da tarefa vira aviso nomeando a suíte, para o vermelho não ser lido como da tarefa. O conflito de uma regra da suíte com o CA só aparece com a implementação: o G30 põe essa suíte no verify, e ele surge na primeira tentativa.
- **`oxe-cc alm supersede <ANTIGO> --by <NOVO>[,<NOVO>] [--comment "…"] [--apply]`:** fecha um card substituído por outros, como os 7 BRD que o refazer do OxeChat na 1.5.2 substitui. Só o escritor.
  - Liga o antigo aos novos com o tipo de link do site: "supersedes", senão Duplicate, senão Relates.
  - Comenta e leva o antigo a um status da categoria done, preferindo transições de cancelar ou substituir, com a resolution "Won't Do", "Superseded" ou "Duplicate" quando o fluxo a tem.
  - A simulação só lê e mostra o tipo de link, a transição e a resolution que usaria.
  - É idempotente: não repete link, não move card já done e não comenta de novo.
- **`alm refine` mantém as seções que o card já tem:** um card escrito por `alm intake --from <spec>` já traz História, Critérios, RN e RT. Agora cada seção da descrição vai para a seção de mesmo nome; o texto antes da primeira seção vira o Contexto, quando não há um próprio. Antes, a coleta punha a descrição inteira em Contexto, cortada depois de umas 12 linhas (por volta do CA-3), zerava o resto para "A confirmar" e um `refine apply` sobrescreveria a spec real (OXE-166 a 169).
- **`quick done --verify` no Windows:** com sintaxe POSIX (aspas simples, `$`, `export`) e o bash do Git instalado, o verify roda no bash. Antes, no cmd.exe, um `'…' && …` quebrava (exit 127).
- **Tamanho dos workflows em LF:** a checagem do `doctor` conta os bytes em LF. Num checkout do Windows com `core.autocrlf`, o `plan.md` lia 45.155 bytes contra 44.594 no repositório e passava do limite suave.
- **Pausa não marca os pendentes como bloqueados:** com o run pausado, as tarefas que não começaram ficam pendentes para a retomada. Antes, a pausa do OxeCode F4 depois da T17 marcou a T18 `upstream_wave_failed` e imprimiu FAIL.

### Custo de falha medido, tentativa reaproveitada e fixtures das suítes (G30b, G36, relatório)

- **`oxe-cc report failure-cost [--since <data>] [--gap-minutes 30] [--json]`:** o custo de falha medido nos eventos e nos CRs do projeto, sem estimativa.
  - Mostra os US$ das tentativas descartadas por causa: o motivo do retry, a classe de falha do bloqueio ou o CR que nomeou a tarefa depois da tentativa, que é o diagnóstico. Uma tarefa concluída e refeita por CR também entra.
  - Mostra as horas paradas: intervalos sem evento dentro de um run.
  - Totais: descartado, gasto e a fração descartada. `failure_cost.fixes` liga uma causa ao seu conserto.
  - Primeira medição, no OxeChat F2: US$ 44,03 descartados de US$ 61,22 (72%) e 2,4 h paradas.
- **G36, `runtime retry T<n> --reuse-attempt [--run <id>]`:**
  - Reaplica a tentativa revertida guardada em `.oxe/runs/<run>/attempts/<Tn>-failed/` (o patch e os arquivos novos), roda o verify da tarefa contra o teste corrigido e, se der verde, commita como checkpoint (`OXE-Task`/`OXE-Run`), sem turno de modelo.
  - Se der vermelho, desfaz tudo e diz para seguir com uma tentativa normal. É recusado se não houver tentativa guardada ou se os arquivos dela estiverem sujos na árvore.
  - Eventos: `AttemptReused` e `AttemptReuseFailed`.
- **G30b, os dados que a suíte lê:** para cada suíte que importa um arquivo da tarefa, inclusive a que já está no verify, o `plan lint` avisa dos arquivos de dados que ela lê fora do `files` da tarefa: import de `.json`, `readFileSync`, `path.join` com literais. Antes, a baseline do guarda da T20 (`palette-commands.base.json`) custou 3 tentativas.

### Teste re-congelado por CR não trava o close (OxeChat F2, 14/11)

- **O lock de aceite do run aceita o re-freeze por CR:**
  - Uma entrada com `resolves`, gravada pelo `spec freeze --cr`, usa o hash novo do arquivo, como já fazia com o `amended` do `plan amend-test`. O `spec freeze` grava `hashes[arquivo]` por arquivo.
  - Antes, o close do OxeChat F2 dava `acceptance_changed` no teste do A6 re-congelado (CR-F2-8, v4), comparado contra o lock da primeira compilação.
- **O dossiê compara o teste congelado com a regra do verify:** bytes, forma LF ou forma CRLF (`frozenFileMatches`, agora exportado pelo runtime).

### Rodada de CR do Celular F3 (14/11)

- **`plan task edit T<n>`:** edita a tarefa sem mexer à mão num PLAN.json em execução.
  - Muda `--wave`, `--depends-on T1,T2|none`, `--remove-paths a,b` e `--notes "…"`, com `--by` e `--reason`.
  - Recusa tarefa done, dependência inexistente, dependência da tarefa sobre si mesma, ciclo e a remoção de um teste congelado.
  - Fica registrado na tarefa (`edits`), em `changes.ndjson` (`task_edit`) e no evento `PlanTaskEdited`.
- **`spec freeze`:**
  - `--proves-filter` e o `--tests` do Gradle valem para testes Kotlin/Java, sobre `pacote.Classe.método`; um `@DisplayName` herda o nome do método que anota.
  - O re-freeze mantém os outros arquivos da entrada. Antes, o RenderedScreen.kt sumia do A7/A8/A9/A11.
- **`runtime feedback`:** um critério de fase ainda não iniciada recebe a fase dona do critério, como no `spec amend`. Antes, a fase ficava "-".
- **`spec add` e `spec amend`:** um `|` no texto vai escapado (`\|`), e a leitura da tabela respeita o `\|`. Antes, o `|` partia a linha e deixava uma célula a mais.
- **`quick done --verify`:** texto com seta de prosa (`->`, `=>`) é recusado antes de rodar. No cmd.exe, ele virava redirecionamento e criava um arquivo solto.
- **`quick` numa worktree sem bloco `alm`:** usa o ALM da worktree principal do clone e diz de onde veio. Antes, não gravava nada no card.

### Teto de US$ antes da próxima tentativa e versão da spec emendada (OxeSpace 14/11)

- **`--budget-usd` vale antes da próxima tentativa:** uma tentativa só começa se o que resta cobre o custo médio das últimas tentativas (até 10) registradas no ledger da fase. Sem histórico de custo, vale o teto puro. Antes, com US$ 59,69 de 60 gastos, a T21 do OxeCode F4 começou e terminou acima do teto.
- **`alm refine apply` numera a spec emendada:** a versão segue o marcador do próprio card. Um sha diferente do aplicado vira `spec-vN+1`, no marcador e no rótulo. O `spec-v1` fica, porque significa "refinado" e é o que o ready gate lê. Antes, uma spec emendada voltava a ser rotulada `spec-v1` (OXE-134, OXE-89, OXE-87).

### Card em desenvolvimento na hora e pedidos da sessão leitora (G27 e G21)

- **G27, o card vai para `in_progress` quando a tarefa começa:** o `runtime execute` dispara a sincronização com o ALM no `TaskStarted`, e não só no fim do execute. Antes, o card ficava em "Pronto" a fase inteira.
- **G21, a sessão leitora grava pedidos para o escritor:**
  - Numa sessão que não é o escritor, o quick registra em `.oxe/alm/pending.ndjson` o comentário (a mini-spec, o fechamento) e o movimento para `in_progress`. Antes, só dizia "ALM só leitura", e o card ficava sem nada.
  - O escritor lista com `oxe-cc alm pending` e aplica com `oxe-cc alm pending apply`. Os comentários vão em ordem, o movimento é só para frente e depois roda um `sync`. Um pedido aplicado nunca é reaplicado.
  - A regra de só mover para frente do quick virou `moveForward`, a mesma usada no dreno.

### Regressão congelada sem falso `acceptance_tampered` (OxeCode F3, 14/11)

- **O verify compara o teste congelado sem depender do final de linha:** o arquivo bate quando os bytes, a forma LF ou a forma CRLF têm o hash congelado, a mesma regra do check do `commit-task`. Antes, a regressão das fases fechadas, com hashes gravados em LF, dava `acceptance_tampered` em 7 testes da F3 com `core.autocrlf`, embora nenhum diferisse da `origin/main`.

### Saída grande do shell não derruba o run (P0, OxeChat F2, 14/11)

- **`run_command` com saída limitada:**
  - O executor guarda os primeiros e os últimos 64 KB da saída, com a contagem do que foi cortado, e para o comando que passa de 64 MB.
  - Antes, um grep recursivo que seguiu a junction do `node_modules` imprimiu mais de 512 MB. O `Buffer.concat(...).toString()` lançou `ERR_STRING_TOO_LONG` e matou o run inteiro na T5.
  - A descrição da ferramenta avisa o agente para excluir `node_modules`, `dist` e `.git` das buscas recursivas.
- **`2>$null` no Windows não cria arquivo:**
  - No Windows o `run_command` usa o cmd.exe. Um redirecionamento para `$null` (PowerShell) ou para `/dev/null` vai para `nul`, e a descrição da ferramenta diz qual é o shell.
  - Antes, o T5 do OxeChat F2 criou um arquivo chamado `$null` na worktree.
- **O checkpoint diz o que está rodando:**
  - Antes de cada comando, o check e os testes relacionados do checkpoint escrevem no stderr o comando, o commit e o teto de tempo.
  - O mesmo vale para a reconferência de um vermelho (no commit, na árvore do projeto e no commit pai).
  - Antes, minutos de silêncio depois do `WorkItemCompleted` pareciam um travamento.
- **Crash do runtime é retomável:** uma exceção não tratada marca o lease como `crashed`, e o `--supervise` e o `autoresume` o relançam, dentro do limite de laço de queda. Um run que termina `failed` continua não sendo retomado.

### Pausa que segura, emenda do CR aberto e freeze (OxeChat F2, 14/11)

- **`runtime pause` segura o execute em curso:** a pausa pedida de outro processo é lida antes de cada tarefa. A tarefa em curso termina, a próxima não começa, e o run termina `paused` com `RunPaused { reason: "requested" }`. Antes, a T3 terminou e a T4 começou mesmo com o run pausado. O autoresume nunca retoma esse run.
  - A saída do `runtime pause` diz se o execute em curso vai ler a pausa. Um execute anterior a esta versão não lê; o aviso diz para pará-lo.
- **`spec amend` usa o CR spec_gap aberto que pediu a emenda:** com `--cr CR-n`, ou sozinho quando há exatamente um CR aberto desse critério ainda sem emenda. Não abre CR novo e usa a versão que esse CR pediu, uma por CR. Antes, a emenda abria CRs novos e levava o critério a v3.
- **`spec freeze --cr`:** diz que o CR segue aberto até o verify rodar o teste verde, como já era o desenho, e como fechá-lo antes.
- **Re-freeze:** um `--command` explícito vence o comando já registrado.
- **`spec freeze` respeita o filtro de nome do comando (OxeCode F4 T20):** o `proves` guarda só os testes que o comando da entrada seleciona.
  - O filtro vem de `--proves-filter "<padrão>"` ou, sem ele, do `-t` / `--testNamePattern` / `--grep` do comando.
  - O padrão é aplicado ao nome completo do teste, com os `describe` que o envolvem, como fazem o vitest e o jest; testes comentados ficam de fora.
  - Um filtro que não seleciona nada é recusado.
  - Antes, um arquivo dividido entre duas tarefas punha os 9 títulos na T20, e os 4 da outra tarefa nunca rodavam (`proof_not_executed`).
  - O `freeze` também aceita `--by`.
- **`quick commit <caminho apagado>`:** registra a remoção, ou não faz nada se o `git rm` já a registrou. Antes, recusava o caminho.
- **`runtime promote` passa pelo hook de origem:** o commit dos testes congelados da tarefa leva `OXE-Task: Fn/Tn`, uma linha por tarefa promovida, mais o `OXE-Run` quando é conhecido. Os testes viajam no PR da tarefa. Antes, o hook commit-msg recusava esse commit e o branch ficava só com o cherry-pick.
- **Um promote que falhou não trava o próximo:**
  - A worktree do próprio promote, suja porque um passo falhou, é removida com força depois de o link do `node_modules` ser desfeito. Antes, o `worktree remove` sem força recusava, e a worktree ficava segurando o branch.
  - A varredura das worktrees de promotes mortos roda antes de conferir o branch. Antes, o promote seguinte dizia "está em uso numa worktree" e pedia uma remoção à mão.
- **Close sem o ensaio de rollback registra o risco (Celular F2):** `program close --no-rollback-check` exige `--by` e `--reason`, e grava `rollback_risk` no `changes.ndjson` e o evento `RollbackRiskAccepted`. A mensagem do gate mostra o comando completo. É o caso de uma fase com merges da main, que não revertem sem `-m`.
- **`quick done` conta os commits de todos os branches (OXE-149):** a busca pelo trailer `OXE-Quick` passa a olhar os branches locais e remotos, além do HEAD, sem os commits de stash. Antes, quatro commits em dois branches contavam como um.

### Suítes fora do verify, fase duplicada, junction e versão do card (G30 e OxeSpace, 14/11)

- **G30, suítes que importam os arquivos da tarefa:** o `plan lint` lista, por tarefa não concluída, as suítes de teste existentes que importam algum arquivo de `files` e não estão nem no escopo, nem no verify, nem entre os testes de aceite da tarefa. A resolução de imports aceita os aliases do tsconfig.
  - É aviso por padrão.
  - Vira erro quando o texto da tarefa cita uma lista ou constante exportada (`export const NOME = [ … ]`, `{ … }`, literal, `Object.freeze`) que a suíte importa pelo nome, porque a suíte afirma sobre o que a tarefa vai mudar.
  - `lint.suite_impact`: `"warn"` ou `"off"`.
  - Nesta rodada, três refações pagas tiveram essa causa (CR-07, CR-08 e o terminal do Celular).
- **`program phase add` idempotente:**
  - o mesmo título logo depois de `--after` não grava nada e diz que a fase já existe;
  - um título já usado por outra fase, ou um critério que outra fase já tem, é recusado sem gravar e indica o `program criterion move`.
  - Antes, rodar duas vezes duplicava a fase e repetia o ROADMAP.
  - O `--depends-on` agora é gravado na fase nova e segue a renumeração; uma fase que não existe é recusada. Antes, ele era aceito e ignorado.
- **`checkpoint-ws` sem junction órfã:** um check morto no meio (reinício, kill) deixava a junction do `node_modules` dentro do `.oxe/`, e um `cp -r .oxe` a seguia por cerca de 118 mil arquivos. Agora, no início de cada check, as sobras com mais de 2 h perdem o link primeiro e depois saem. A pasta real das dependências nunca é tocada.
- **`oxe-cc alm version <KEY> <versão> [--comment "…"] [--apply]`:** troca a versão de correção (fixVersion) de um card existente.
  - Só o escritor pode usar, e sem `--apply` sob `require_apply` é uma simulação.
  - Se o card já está nessa versão, nada é gravado.
  - A versão precisa existir no projeto do Jira.
  - Com `alm.transport: "mcp"`, o comando diz para usar a ferramenta do MCP.
  - `oxe-cc alm summary <KEY> "<título>" [--comment "…"] [--apply]` troca o título de um card existente: só o escritor, simulação sem `--apply` sob `require_apply`, até 255 caracteres. É o caso do OXE-160, cujo refine estreitou o escopo enquanto o título ainda citava o diálogo removido.
  - `alm version <KEY> …` chega ao comando: antes, o roteamento do `alm version ensure` o interceptava e respondia com o uso do ensure.

### Prova de teste no Kotlin/Gradle e hooks sem esqueleto (Celular F2 e OxeChat F2, 14/11)

- **`proves` com Gradle:**
  - A linha do testlog do Gradle (`Class > method PASSED|FAILED|SKIPPED`) conta como nome de teste. Vale também com a duração e com o prefixo de job e timestamp do log da CI. Antes, os testes Kotlin que rodaram davam `proof_not_executed`.
  - O anexo do JUnit XML também pega um wrapper com "gradle" no nome (`gradle152.mjs`).
  - O lint não pede mais "reporter verbose" para gradle, gradlew e mvn.
  - A saída do check vai até 32 MB; antes eram 2 MB, que cortavam um build Android.
- **Hook nunca cria `.oxe/`:** o pre-push fica no `.git` comum e roda em toda worktree. O `runtime pre-push`, assim como o `runtime autoresume`, não faz mais o bootstrap do `.oxe/` num checkout que não tem um.
- A mensagem de uso do `spec add` lista `--by` e `--reason`.

### ALM: simulação que nunca grava, e escrita explícita (OXB-G12 a G15)
- **`--dry-run` nunca grava no ALM, em nenhum comando (G13, P0):** antes, `alm refine apply --dry-run` aplicava de verdade.
  - O transporte REST recusa POST, PUT, PATCH e DELETE em simulação; a consulta WIQL do Azure é a única leitura liberada.
  - O apply simula: lê, roda o lint e diz o que gravaria e para onde moveria.
  - Um teste por comando que escreve, com um Jira falso que falha em qualquer escrita: intake, version ensure, push, sync, move, comment, link, defect, refine --claim, refine apply, grill publish e trace publish.
- **`alm.require_apply`:** com `true`, gravar exige `--apply`; sem ele, todo comando que escreve vira simulação.
  - **Deprecação:** nesta versão o padrão continua `false`, mas uma escrita sem `--apply` avisa: "na próxima versão vai exigir --apply". Na próxima minor o padrão passa a `true`.
  - Os workflows já passam `--apply` onde gravam.
- **`refine --claim` diz o que fez (G14):** cada card mostra "→ movido para Em refinamento", "moveria para …" ou "não moveu: <motivo>". Antes, o claim movia o card e o CLI imprimia "só leitura".
- **Comentário do grooming (G12):** os fatos ficam em "Fatos (fonte): N", cada um com a fonte, e as perguntas em "Perguntas: N (X respondida(s), Y em aberto)". Antes, os fatos eram contados como perguntas.
- **`grill answer` (G15):** o eco mostra a fonte dada em `--source`, não "decisão do usuário".

### Fechamento de fases, refine de interface e quick (depois do 4a7f39a)
- **Falha de rede num gate:** quando a saída de um gate de fase tem assinatura de rede, o gate não abre CR (`GateInfraFailure`). Valem dial tcp/connectex, "forcibly closed", WSAE*, ECONNRESET/TIMEDOUT, TLS, DNS, HTTP 5xx e rate limit. O runtime classifica a falha como `env_setup`, não `deterministic`.
- **`plan pack fix T<n> --symbol <arquivo>#<nome> --internal | --member-of <Classe> | --remove`:** corrige um símbolo do pack sem reabrir a tarefa. A correção fica em `fixes` e no evento PackSymbolFixed.
- **G34:** um card de interface só passa do lint do refine com o BRD-n, o alvo aprovado e medidas nos CA, nos dois temas e nas duas densidades. Sem isso, o card fica needs-info, com a pergunta para a MARCA.
- **G33:** `guards install` instala só os hooks do git. As guardas do Claude Code (PreToolUse) passam a exigir `--claude-guards`; o `install --guards` continua instalando-as.
- **`spec freeze`:**
  - lê os títulos com o leitor do plan lint, então escapes, `.each` e template literals saem iguais;
  - refazer o freeze para o mesmo CR é idempotente.
- **`quick`:**
  - `quick cancel --reason [--evidence]` fecha o quick como abandonado, nunca como concluído. Comenta no card, sem movê-lo, e o próximo quick do card registra `follows`.
  - Numa pasta sem ALM, o quick diz que nada foi gravado no card.
- **`ship known-failure`:**
  - `move <id> --item <KEY>` leva a falha para o card certo;
  - `remove wt:KF-n` tira só aquela entrada;
  - `--help`.
- **`alm status <KEY>`** lê a coluna do card.
- **`dry_verify.timeout_ms`** configura o timeout por comando.
- **Orçamento esgotado:** a mensagem diz que o teto é o acumulado da fase.

### Refazer por CR sem verde falso, e commit das tarefas (depois do 253492c)
- **P0, verde falso:** uma tarefa reaberta por um CR aberto passa a rodar, no próprio verify (compile), os testes congelados que resolvem o CR, ligados por tarefa ou por critério.
  - Ela nunca reaproveita o checkpoint de antes do CR. Uma tentativa que não mudou nada vira `empty_checkpoint`, com o CR no motivo.
- **`runtime commit-task`:**
  - commita uma tarefa marcada done sem commit, e o commit leva `OXE-CR` para cada CR aberto que a reabriu;
  - `commit-task T11,T12 --together` faz um commit só para tarefas misturadas em arquivos compartilhados, com um `OXE-Task` por tarefa e esse commit como done_commit de cada uma.
- **Commit por tarefa com a trava de origem:** se ela estiver ligada, o execute commita cada tarefa por padrão. Com `checkpoint_commits: false`, avisa no início.

### Do uso real no OxeSpace (depois do 9389450)
- **`origin.exempt.commits`:** isenção pontual por SHA completo, com `reason` e `by` obrigatórios. Toda isenção usada aparece no relatório, e uma entrada inválida faz o check-origin sair com 1.
- **G23:** com `origin.since` por commit, os commits com data anterior à do commit de corte também contam como histórico. É o caso de uma branch longa aberta antes da regra.
- **Dry-verify de tarefa reaberta:** roda o teste congelado que resolve o CR aberto, ligado por tarefa ou por critério. Uma tarefa reaberta com o teste do CR vermelho nunca sai "já verde".
- A normalização do plano preserva o `task` de cada entrada de aceite.
- **`spec freeze --task Tn`.**
- **`runtime feedback resolve CR-n --no-amendment`:** um spec_gap que não emendou o critério, ou que foi retirado, não versiona o critério nem deixa os testes stale.
- **`alm link --cr` / `--kind`:** o vínculo mantém o tipo e os campos do histórico e grava o CR; antes, o bug virava tarefa.
- **Falha conhecida não é "bug sem CR"** no trace nem no gate do close.
- **Preflight visual:** passa a ler só a prosa da SPEC, então um nome de arquivo ou um trecho de código não conta mais como entrada visual. Também aceita `not_applicable` no VISUAL-INPUTS.json.
- **`spec add requirement`:** lê requisitos em bullets (`- R1 (CODE-8): …`), e o `--before` acha o cabeçalho pelo prefixo.
- **`program start`** de uma fase inexistente aponta o `program phase add`.

### Simulação local, corte da trava e guarda-chuva (depois do e421105)
- **P0: `quick --dry-run` não grava nada local:** nenhum registro, QUICK.md, evento nem commit, e não roda a verificação. A regra do G13 passa a valer também para as escritas locais.
- **G19, corte e config versionada:** `origin.since` aceita um commit ou uma data, e o que é anterior ao corte vira histórico. O `oxe.config.json` versionado vence o `.oxe/config.json`; `--config <arquivo>` aponta outro. O `check-origin` roda sem `.oxe/`.
- **G20:** `origin.exempt.authored` isenta um autor só nos caminhos dele, por exemplo o bot que regrava as goldens.
- **Guarda-chuva:** `alm label <chave> --add <rótulo>` e `alm link <chave> --relates <chave,…>`, os dois com `--apply` e sem repetir. `alm.ref_label: "plain"` gera o rótulo do intake como `ref-<id>`.
- **`grill start` aceita os tipos do ALM** (story, task, bug, epic, spike). Com `--card` e sem `--type`, usa o tipo do card.
- **`grill mark --late <etapa>`:** marca um fato que o grooming não achou e que apareceu depois, no planejamento ou na execução. O `grill report` mostra a profundidade do grill.
- **`alm intake --dry-run` sem credencial** confere o arquivo offline, com o lint do refine.
- **Gates internos do oxe-build** (stub-check e os demais scripts do pacote) rodam sempre locais. O `phase_gates_runner` remoto só envolve os comandos do repositório.

### Origem dos commits, quick com registro e CI por PR (G5, G8, G9, G11)
- **`oxe-cc quick <KEY> "<objetivo>"` (G9):** o quick vira comando, com um registro verificável em `.oxe/quick/<id>.json` e a minispec no QUICK.md.
  - `quick commit -m "…"` faz o commit com os trailers `OXE-Quick` e `OXE-Card`, para o commit à mão não virar o buraco da trava.
  - `quick done --verify "<cmd>"` roda a verificação e fecha com os commits achados pelo trailer.
  - Com ALM, o card recebe a minispec e vai para "em desenvolvimento", só de uma coluna anterior, nunca para trás. No `done`, o card recebe os commits e a verificação.
- **Trava de origem (G11):** `oxe-cc ship check-origin [<#PR>|<a..b>]` exige que todo commit venha do `runtime execute` (`OXE-Task`) ou de um quick registrado (`OXE-Quick`, mais `OXE-Card` com ALM).
  - As isenções ficam só em `origin.exempt`: merges, autores (bots do trem e da release) e caminhos (`.oxe/`, `docs/releases/`).
  - O `guards install` instala o hook `commit-msg`. Com um quick aberto, o hook acrescenta os trailers; sem quick, recusa o commit (`origin.commit_msg`).
- **CI por PR, por card e do repositório (G5/G8):** `ship status --pr <n> | --card <KEY> | --repo` dá o veredito de PRs fora de fase, com os rótulos do trem.
  - Um número passado ao comando é PR, nunca pasta.
  - `--comment --apply` põe o veredito no PR, num comentário "CI (OXE)" atualizado no lugar.
- **Falhas conhecidas do repositório:** ficam em `<git common dir>/oxe/`, compartilhadas por todas as worktrees, e expiram no merge do PR do conserto (`ship known-failure prune`).
- **`ship --help`** e a ajuda geral passam a listar `ship`, `quick` e `workflow`.
- **`oxe-cc workflow path <slug>`:** os comandos `/oxe-*` caem para os workflows do pacote instalado quando o repositório não tem `.oxe/workflows`. O `doctor` avisa e dá a correção (`install --oxe-only .`).

### Jornada SDLC guiada e grill na spec
- **Grill (`oxe-cc grill …`, padrão do `/oxe-spec`):** a descoberta da spec virou uma árvore de decisões (problema → personas → escopo → fluxos → regras/glossário → bordas → NFR → integrações → rollout → métricas → riscos), percorrida uma pergunta por vez, cada uma com a resposta recomendada e o porquê.
  - O que o código responde vira fato com fonte e não é perguntado.
  - Uma resposta que muda reabre as perguntas e os ramos que dependiam dela.
  - Contradição bloqueia até ser resolvida. "Não sei" vira suposição explícita.
  - O tipo da demanda define quais ramos são obrigatórios.
  - O estado (`.oxe/grill/grill.ndjson` + `GRILL.md`) é retomável entre sessões.
  - O `grill close` só aceita sem pendência; ao fechar, grava `.oxe/GLOSSARY.md`, preservando o texto humano, e registra as decisões (as opções não escolhidas entram como alternativas recusadas), que viram ADRs.
  - `--fast` mantém os blocos de perguntas de antes.
- **`oxe-cc spec check` / `spec approve`:** o portão de qualidade do upstream checa:
  - v1 R→A, Risco e Como verificar em todo critério, ids únicos;
  - PRD;
  - sinônimos proibidos do glossário;
  - grill fechado e com as decisões no registro, e suposições na SPEC;
  - RFC para P0/P1;
  - critérios no ROADMAP.

  A aprovação só acontece sobre um check verde e fica registrada (evento e `changes.ndjson`, com o hash da SPEC). Uma SPEC alterada depois da aprovação volta a pedir aprovação.
- **Próximo passo guiado em toda a jornada:** o `suggestNextStep` agora cobre:
  - grill aberto (com o próximo ramo), spec a aprovar;
  - histórias e tarefas a enviar ao ALM, fila do MCP;
  - RFC da fase em rascunho, ou exigido (`/oxe-discuss --rfc`);
  - com `delivery.mode: "pr"`, a entrega depois do verify verde: PR → CI/merge → deploy anexado → close.

  `oxe-cc status --journey` mostra o mapa das etapas 0 a 9, e `oxe-cc ship status` mostra PRs, merges (via `gh pr view`) e deploys. Todo workflow termina com o mesmo rodapé de próximo passo (`references/next-step-footer.md`).
- **`/oxe-ship` virou "entregar":** PR com a chave do ALM → CI e merge → deploy anexado → docs → `program close` → ALM em "lançado", um passo verde por vez. O commit local ficou em `--local`, e `--defect` registra o defeito pós-deploy (item no ALM ligado à origem, mais um CR).
- **`/oxe-discuss --rfc`, `/oxe-alm` e `references/change-management.md`:**
  - `/oxe-discuss --rfc` decide a proposta técnica antes do plano, com as perguntas em aberto no estilo grill;
  - `/oxe-alm` é o setup do bloco `alm` por perguntas, mais status, push, fila e defeitos;
  - `change-management.md` diz qual comando usa cada mudança no meio do caminho, e o roteador `/oxe` encaminha os pedidos em linguagem natural.
- **Verificação remota (`verify.remote`):**
  - Os checks pesados (e2e, build empacotado, Android) rodam no CI do repositório no GitHub; os leves ficam locais. `where`/`remote_job` vão por check, critério, tarefa ou `verify.where`.
  - O dispatch vai sem inputs (um input de publish, release ou deploy é recusado), reaproveita um run verde no mesmo commit e acha o run do dispatch pelo commit e pelo evento.
  - Nunca empurra para main/master ou branch protegido, e nunca usa `--force`. Sem upstream, só com `--push`.
  - Um job vermelho reprova o critério, com o link. GitHub indisponível ou tempo esgotado deixam o check como "não verificado", e a fase segue (`required: true` exige o remoto).
  - O run vira evidência de CI da fase. `runtime verify --no-remote` roda tudo local.
- **Da coordenação de ALM (13–14/11):**
  - **Um escritor por programa** (`alm.writer` + `OXE_ALM_WRITER`): as demais sessões só leem e comentam (`oxe-cc alm comment`), e uma trava local recusa dois escritores na mesma máquina. Duas sessões tinham criado o mesmo lote, com 19 duplicados.
  - **Versão-alvo por id** (`update.fixVersions[].set`): um PUT de `fields.fixVersions` voltava vazio. Agora ela é conferida e aplicada também em item adotado e em item criado sem ela.
  - **Falhas conhecidas de CI** (`oxe-cc ship known-failure add|list|remove`): o `ship status` classifica o CI de cada PR. Uma falha cujo teste bate com uma falha conhecida de item aberto sugere `gh run rerun <id> --failed` em vez de regressão.
  - **`verify.remote` mais leve:** espera por consultas curtas e retomáveis (estado em `remote-verify.json`, `detach`), trace da CI baixado quando um job falha, e `where: "both"` marca `ci_only`.
  - **`verify.min_free_mb`:** abaixo do piso, nenhum check pesado roda na máquina.
  - **`oxe-cc alm refine`** (pedido do usuário, 14/11): relê os cards do Jira para um spec guiado por tipo.
    - História: Como/Quero/Para, critérios Dado/Quando/Então com o teste que prova cada um, regras de negócio e técnicas, fora de escopo e definição de pronto. Bug: reprodução, esperado × obtido, causa, critérios de correção e teste de regressão. Tarefa e épico têm modelos próprios.
    - A coleta só lê: card, comentários, ligações, épico, PRs, commits e builds, design e código citado. O agente da sessão reescreve sem inventar: o que não tem fonte vira "A confirmar", com a pergunta. O `oxe-cc` não chama modelo pago.
    - O lint reprova critério vago, critério sem teste, fora de escopo vazio e "A confirmar" sem pergunta.
    - O `apply` é só do escritor: grava a descrição em ADF com títulos, guarda o texto original num comentário e aplica `spec-v1` (mais `needs-info`, com as perguntas comentadas). Nunca sobrescreve um card editado depois da coleta sem `--confirm-overwrite`.
    - `alm.ready_gate`: sem `spec-v1`, o item não vai para "Em andamento".
  - **12 etapas canônicas no ALM:** intake, grooming, refinement, ready, in_progress, review, verified, queued, integrated, staging, accepted e released, cada uma mapeada para a coluna do quadro em `alm.states`. Os nomes antigos continuam aceitos.
    - O refine move as etapas dele: `--claim` leva para refinement; o `apply` leva para ready (sem perguntas) ou de volta para grooming (com needs-info).
    - O ready gate vale antes de ready e de in_progress: exige `spec-v1` e nenhum `needs-info`.
    - O teto padrão do lote do refine é 15 cards.
  - **Ids de tarefa estáveis e reabertura explícita** (lição do F2 CR-36, que motivou um wrapper no OxeSpace):
    - O `plan merge` sobre o PLAN.json atual mantém o id de cada tarefa pela chave (`rid`); a tarefa nova recebe o próximo id livre, e as concluídas continuam concluídas, com o commit. Antes, a numeração por profundidade deslocava ids, e o executor devolve trabalho interrompido pelo id.
    - O `runtime feedback` só reabre tarefa com `--reopen`; sem ele, liga o CR às tarefas e mostra o comando.
  - **`oxe-cc trace`:** o grafo de rastreabilidade. Cada referência vem do lado filho e o reverso é derivado. O comando lista os órfãos, cada um com a correção: história sem critério ou card, critério sem história ou teste, decisão sem âncora, CA ↔ A divergentes, CR de defeito sem bug e bug sem CR, tarefa citando decisão não vigente.
    - `trace publish [--apply]` mantém um comentário "Documentos (OXE)" por card, atualizado no lugar: o link para o PRD, os critérios com a última evidência do verify, as decisões com o link do ADR (`alm.docs: { repo, branch }`) e os CRs.
    - O ADR lista as histórias com a chave do card. O `alm defect --cr CR-n` liga o bug ao CR. O lint do refine confere os sinônimos proibidos do glossário.
  - **Decisões com âncora:** o RFC aceito grava como critérios e histórias os A-n e US-n citados na Motivação e no Resumo, e a decisão do grill herda o `--affects` da pergunta. O ADR lista "Critérios" e "Histórias"; antes, os dois nasciam sem ligação.
  - **CA ↔ A explícito:** o `oxe-cc alm refine import <KEY>` leva os critérios do card refinado para a SPEC: um A-n novo, citando a chave e com o teste e o risco do CA, e o `(A-n)` escrito de volta no CA. Um CA que já tem o seu A é conferido. O lint do refine passa a checar os dois lados. Uma fase executando ou fechada está congelada: com `--phase` dela, o import recusa e mostra o comando de CR; um CA que muda um A congelado vira proposta de CR com versão nova (`--amend-to`), nunca edição direta.
  - **`alm.stories_source`:** com `"alm"`, o push nunca cria história nem épico; liga a US do PRD ao card citado na linha dela e lista as que faltam. Um item que cita a chave do card (`(OXE-20)`) é adotado pela chave, confirmada por GET, sem a busca por rótulo.
  - **`oxe-cc alm metrics`:** tempo em cada coluna (mediana, p85), lead time, cycle time, vazão por semana ISO, quantidade em cada coluna agora, limites de WIP (`alm.wip`, só aviso) e o gargalo pela mediana. Uma coluna renomeada no quadro é contada pelo id. O relatório vai para `.oxe/alm/metrics.md`.
  - **O ALM nunca recua um item:** antes de mover, o OXE lê o estado real e pula se outra ferramenta já o levou mais adiante (por exemplo, um workflow de jira-sync que move PR, trem, main e release). Com `track: ["in_progress"]`, o OXE só move A fazer → Em andamento.

### Execução que não desperdiça nem esconde a causa
- **Turnos por tarefa (OXB-185):**
  - a tentativa que termina no teto é `turns_exhausted`, com a contagem, e nunca é chamada de escopo ou de verify;
  - os turnos saem do tamanho da tarefa (`max_turns` › `size` › estimativa; S 15 · M 30 · L 60);
  - `runtime.provider.maxTurns` passa a ser o teto.
- **Tentativa que gira sem escrever (OXB-186/196):**
  - evento `ExecutorTurn` por turno (turno n/N, tool calls, arquivos escritos, tamanho do prompt, latência) e `ExecutorSlowTurn` acima de `execute.slow_turn_ms`;
  - `execute.no_progress_turns` (padrão 8) turnos sem escrita nem `finish_task` encerram a tentativa como `no_progress`, contabilizando também arquivos em escopo gerados/modificados por `run_command` (OXB-196);
  - o adaptador `claude` não força mais o modelo padrão do provider http (`claude-sonnet-4-6`) como `--model`, que foi a regressão de latência do rc.37/rc.38: sem modelo da tentativa, vale o padrão do Claude Code, como no rc.36.
- **Cota, retomada e ruído de watcher (OXB-191/192/204):**
  - falhas de cota/rate-limit (`You've hit your .* limit`, `429`, `RESOURCE_EXHAUSTED`, `overloaded_error`) pausam em `paused_environment` (`quota_exhausted`) antes de gastar tentativa, sem retry cego, sem rollback do código em progresso e sem marcar `deferred` (OXB-191); os padrões embutidos exigem a redação do provedor e não valem para a saída de um verify (um teste "resets the form" ou um erro na linha 429 continua sendo falha de lógica; padrões do projeto vão em `execute.failure_classes`), com backoff automático quando o provedor informa janela curta de reset (OXB-204);
  - `TaskStarted` + `status: "in_progress"` permitem retomada auditável via `oxe-cc runtime resume` (`inspect | continue | reset-task`) validando JSON/TS na árvore suja (OXB-204);
  - strings benignas `FileSystemFileChangedEvent` com exit `0` ou após `finish_task` não abortam o fechamento da tarefa como `paused_environment` (OXB-192).
- **Adaptador Antigravity (`agy`) e commit atômico externo (OXB-197/200):**
  - `runtime.provider.name: "antigravity"` executa tentativas via `agy -p` / `--model` em paridade com `claude` e `http` (OXB-197);
  - `oxe-cc runtime commit-task Tn` permite que subagentes externos ou fallback fechem tarefas validando escopo, `sha256` congelado, `stub-check` e `verify`, gravando `TaskCompleted` + `CheckpointCreated` no ledger (OXB-200).
- **Stub marcado como bloqueado não fecha tarefa (OXB-188):** BLOCKED / "OXB stub" / "until … lands" num comentário vira `scope_insufficient` com o arquivo fora do escopo que falta, e o checkpoint done recusa qualquer marcador de stub adicionado.
- **Teste relacionado que passa sozinho não recusa o checkpoint (OXB-189):** `vitest related` só com arquivos (sem diretório nem e2e), rerun de um arquivo com `--maxWorkers=1` e, se ainda vermelho, na árvore do projeto (verde ali = `flaky_reds`, o commit fica); `related_set_size` no evento.
- **`test.each` no proves (OXB-190):** os títulos de `test.each` / `it.each` / `describe.each` (template, parte literal e nomes expandidos de tabela literal) contam como testes declarados.
- **Modelo explícito (OXB-187):** o execute diz qual modelo vai usar e quem o escolheu (`ExecutorModelResolved`), e avisa quando é um padrão que ninguém escolheu.
- **Falha classificada antes de cobrar tentativa (OXB-120):** falha de ambiente ou de cota pausa a run sem gastar a tentativa.
- **Retry informado:**
  - o prompt diz o que a tentativa anterior deixou na árvore (OXB-184);
  - os logs de tentativa não se sobrescrevem entre execuções (OXB-184).
- **Adiar a tarefa que não converge (OXB-138):** a tarefa vai para `runtime deferred`, e as independentes seguem.
- **Checkpoint por tarefa correto (OXB-167–177):**
  - o commit leva só o conteúdo da própria tarefa, inclusive num arquivo compartilhado;
  - um checkpoint que falha para a run com aviso;
  - os baselines são da 1ª tentativa e as interrupções valem entre runs;
  - um vermelho relacionado é rodado de novo sozinho antes de contar (OXB-178).
- **Sinal de atenção (OXB-145):** `.oxe/ATTENTION.md`, um hook `attention.notify` chamado uma vez por pausa e `runtime attention resolve`. O `status` mostra a atenção no topo.
- **Opt-ins:**
  - canal de pergunta do executor (`execute.ask_orchestrator`, OXB-125);
  - despacho em fluxo (`execute.dispatch: "stream"`, OXB-129);
  - estratégias de reparo retry/decompose/prune (`execute.repair`, OXB-130);
  - subida de nível de modelo depois de falha de lógica (`models.tiers`, OXB-131).

### Plano e spec
- **`plan build`, `plan check-role` e kinds (OXB-097/098/106/193–195/198/199/201–203/206/207):**
  - `oxe-cc plan build --from <papéis>` grava PLAN.json, PLAN.md e o pack juntos: ondas por arquivo quente, símbolos tirados dos imports dos testes congelados e a fase;
  - expansão automática de diretórios em `files`/`deleted` e suporte a prefixos no `scope-guard` (OXB-193);
  - filtragem automática de testes deletados pela tarefa ou por suas dependências fora do `verify` (OXB-194);
  - regras `coupled_scope` para arquivos de governança/contrato (`mcp-coverage`, `file-size-baseline.json`, `palette-commands.base.json`, `THIRD_PARTY_NOTICES.md`, `e2e/offer-audit.spec.ts` com aviso sobre `MENU_EFFECTS`), injeção automática de `tests/design-lint*.test.ts` no `verify` de tarefas `FE-*` que criam/editam `.tsx`/`.css` em `src/` e gate automático `npm run notices:check` ao tocar `package.json` (OXB-195/202/207);
  - fechamento de 1 salto no grafo reverso de imports (`--auto-close-imports`), mapas `Record<Union, ...>` em encolhimento de união e varredura automática de suítes legadas (`tests/**`, `e2e/**`, `appMenus`, `threat-model`) em tarefas de remoção (OXB-198/199/206);
  - validação de `edited_paths`/`deleted_paths` contra `git ls-tree HEAD` com sugestão de arquivo renomeado via `git log --diff-filter=R` (OXB-201);
  - resolução de aliases `id -> rid` em `depends_on` e ordenação automática de tarefas `BE` de IPC antes de consumidores `FE-*` em `--pair-as-deps` (OXB-203);
  - `plan check-role` valida um papel antes de ele ir para o TL;
  - kinds `add|remove|move|test-only|config-only`.
- **`plan skeleton` (OXB-154):** stubs de compilação a partir das assinaturas do pack, para Kotlin, TS/JS, Python e Java.
- **Plano velho (OXB-126):** `plan staleness` e `plan refresh` detectam um plano escrito contra código que mudou.
- **Spec e emendas auditadas de testes congelados (OXB-123/099/143/205):**
  - `spec probe` traz as bordas e as proibições de cada critério;
  - `spec freeze --from <PR|sha>` importa os testes congelados com proves, hash e origem;
  - `spec stress` estressa a spec com métodos fixos em leitores independentes;
  - `plan amend-test <path> --reason "<CR-id>"` atualiza o `sha256` em `PLAN.json` sem perder tarefas `done` e grava `FrozenTestAmended` (OXB-205).
- **Decisões, pesquisa e lints (OXB-112/182/134/142/111):**
  - decisões são ids de primeira classe, com as alternativas recusadas e quem as recusou;
  - a pesquisa separa a afirmação com fonte da suposição (`assumption_without_risk`);
  - o lint aponta código copiado no pack (`derivable_inlined`);
  - `plan lint --review`.

### Verify, close e evidência
- **Na tarefa e na promoção:** anti-stub (OXB-108), rigor do teste congelado incluindo regex suspeitas sem barra invertida como `/d+/` e sockets `net.connect` pausados sem `resume()`/`'data'` no Node 22+ (OXB-109/205/208), checagem de `check-file-size.mjs` + `notices:check` na integração/promoção (OXB-202) e bloqueio de diretórios `tests/acceptance/parked-*` rastreados pelo Git no `promote` e `pre-push` (OXB-206).
- **Defeitos, vereditos e achados:**
  - registro de defeitos abertos (OXB-110);
  - veredito e sign-off presos ao commit e à versão do critério (OXB-124);
  - severidade dos achados lida de uma tabela (OXB-137);
  - revisão de costura (OXB-136);
  - auditoria de dependências (OXB-127).
- **Risco por critério (OXB-140):** o close decide **PASS / CONCERNS / FAIL**, com waivers datados por fase (opt-in).
- **Critérios não funcionais (OXB-144):** mediana e dispersão medidas, gate no verify da fase e achado de regressão.
- **Pacote de evidência de UI (OXB-128):** reproduzível, exigido pelo sign-off de critério permanente de UI (opt-in).
- **SYSTEM-DESIGN (OXB-104/105):** o artefato, mais o gate `design_drift` no close.
- **Gates como plugins de config (OXB-107):** `signoff`, `script` e `gate_plugins`.

### Revisão independente (OXB-178b, 179, 139, 180, 181)
- **O processo:** a revisão roda num processo separado (`claude -p` sem ferramentas, numa pasta vazia) e grava um recibo com os hashes do que recebeu e um sentinela contra vazamento.
- **As rodadas:**
  - um registro guarda os achados entre rodadas e a regra de convergência;
  - o número de rodadas é limitado, e o escalonamento vira CR `spec_gap`;
  - o autor responde cada achado com uma de quatro saídas;
  - `plan lint --read` faz a leitura sem contexto, com um leitor de fora e um implementador.
- **Custo:** nada disso roda dentro do execute; são chamadas pagas e explícitas.

### Contexto e workflows
- **Handoff e folga de contexto:** `runtime handoff`, `runtime context --used --limit` (OXB-113).
- **Orçamento de tamanho (OXB-132):** limite por workflow e persona, variante compacta dos workflows longos e `runtime context-pack --task`.
- **Avaliação comportamental dos workflows (OXB-141):** `oxe-cc eval workflow`, com regras determinísticas e mutações semeadas.
- **Personalização sem cópia (OXB-146):** sobreposições por equipe e por pessoa (`.oxe/custom/`), reaplicadas no update.

### Programa, coordenação e release
- **Coordenação:**
  - `program queue`: o próximo item de cada papel (OXB-103);
  - `runtime train`: ciência do merge-train, nunca empurra um PR no trem (OXB-102);
  - `program member`: programa com mais de um repositório, com os shas pousados por fase (OXB-135).
- **Documentos e regressão:**
  - `docs check`: os documentos fechados conferidos contra o código atual (OXB-183);
  - `program snapshot` / `program regress`: regressão sobre o `.oxe/` de programas reais, com os snapshots fora do repositório (OXB-101).
- **Canais:** `release channel` com `next` e `stable`, este último só depois de uma fase real fechada; o comando nunca publica (OXB-100).
- **doctor:** 44 chaves de `.oxe/config.json` que o runtime lê (`task_gates`, `execute`, `parallel`, `deps_strategy`, `checkpoint_check`…) eram chamadas de "não usadas pelo oxe-cc"; a lista agora é testada contra as chaves que o código lê.
- **plan lint:** um arquivo que a tarefa cria, importado sem extensão pelo teste congelado (`files: [menu.tsx]`, `import '…/menu'`), está no escopo; os caminhos fora de `files` de um mesmo teste saem numa linha só; sem PLAN.md, o preflight já lista IMPLEMENTATION-PACK, REFERENCE-ANCHORS e FIXTURE-PACK na mesma rodada.
- **verify:** um check que falha só pelo timeout do próprio runner ("Test timed out in 5000ms", sem asserção falhando) roda mais uma vez sozinho antes de contar; verde no rerun passa, e o VERIFY.md mostra os dois resultados. Se o timeout se repete, a falha é `timeout`, nunca `deterministic` ([HIGH]).
- **program start/status:** uma fase em `planning` cujo PLAN.json já existe (da própria fase, com tarefas) aponta para `oxe-cc runtime execute`, ou para corrigir o plano quando o plan lint tem erros, em vez de `/oxe-plan`.
- **plan lint:** o `HINT(html-fetch)` (app aberto em `file://`) só aparece num projeto com cara de app estático: um `index.html` e nenhum bundler, framework ou Electron no `package.json`.
- **plan lint / execute:** um símbolo do IMPLEMENTATION-PACK num arquivo que existe e não o define vira aviso no `plan lint` (erro quando o arquivo está fora de `files` da tarefa). No execute, se o stub-check reprova só por símbolos que nem a base tinha e a tentativa não criou, a tarefa para na 1ª tentativa (`pack_symbol_missing`) com "o pack nomeia um símbolo que não existe", em vez de pagar retries que não podem passar.
- **program close:** num branch com PR aberto (`gh pr list --head <branch>`), a fase fecha mas o commit não é feito. A mensagem diz o PR e o que fazer (commitar num branch separado, ou `--force-branch`). Antes, o close commitava no branch de um PR que já estava na fila do trem de merge.
- **PRD:** o `/oxe-spec` passa a escrever `.oxe/PRD.md` (`oxe/templates/PRD.template.md`) acima da SPEC, com problema, personas, métricas (M-n) e histórias de usuário (US-n: Como / Quero / Para) ligadas aos R* e A*. O `oxe-cc prd lint`, também dentro do `plan lint`, acusa história sem critério, critério sem história, referência inexistente e métrica sem meta. São avisos; viram erro com `prd: { required: true }`.
- **RFC:** proposta técnica antes do plano de uma fase de risco: `oxe-cc rfc new | accept | reject | list` (`.oxe/rfc/`, template `RFC.template.md`). O `accept` exige as perguntas em aberto respondidas e registra a decisão (ADR) com contexto, proposta, riscos e alternativas recusadas. O `plan lint` avisa fase com critério P0/P1 sem RFC aceito; com `rfc: { required: "risk" | "always" }` é erro.
- **Documentos versionados:** `oxe-cc docs publish` copia PRD (com a chave do ALM de cada história), RFCs (com índice), ADRs e SYSTEM-DESIGN para `docs/`. Com `docs_publish: { "dir": "docs" }` configurado, o close da fase publica antes do commit e os documentos entram nele; sem essa chave, o close não escreve nenhum arquivo além dos que já escrevia. Sem decisões registradas, nenhum ADR é escrito. O `program init` cria o SYSTEM-DESIGN quando não existe, para o gate de design desatualizado valer desde a fase 1.
- **ALM (Jira / Azure DevOps):** bloco `alm` no config, com credenciais só por variável de ambiente.
  - `oxe-cc alm push` cria épico, histórias do PRD e uma tarefa por tarefa do plano. É idempotente pelo rótulo `ref-<programa>-<ref>`, adota um item existente pelo código antigo (`adopt_prefixes`) e aplica a versão-alvo por fase.
  - `alm sync` move os itens por etapa pelo nome do estado: tarefa iniciada, PR aberto, promoção que falhou (volta com comentário), merge (via `gh pr view`) e deploy, com a versão lançada se `release_version: true`. `alm.track` limita as etapas que o OXE move.
  - `alm move` serve para o trem ("Na fila"), `alm link` para a ligação manual e `alm defect` para o defeito depois do deploy, ligado à origem.
  - `alm.transport: "mcp"` dispensa o token. Push, sync, move, defect e o sync automático decidem o que fazer e põem as operações na fila `.oxe/program/alm-mcp-queue.json`, na ordem:
    - `ensure`, com a busca JQL ou WIQL a rodar antes de criar e o pai por `parent_ref` enquanto ele ainda está na fila;
    - `transition`, em que o último estágio vence e os comentários se somam;
    - `link` e `release_version`.
  - O agente executa a fila com as ferramentas MCP da sessão e reporta cada operação com `alm ack <id> --key …` (ou `--error`), que grava o mesmo registro do modo REST. `alm queue` mostra a fila, o `runtime execute` avisa quando há operações pendentes, e `alm link` manual também resolve o `ensure`.
  - A chave entra no título do PR, no assunto do commit de checkpoint e no nome do branch do promote.
  - O registro local é a defesa contra duplicata, porque a busca do Jira por rótulo leva minutos para ver um item novo. A chave é gravada logo depois do POST, e a confirmação usa GET por chave. Com `ledger_guard: true`, um push sem registro se recusa a criar até um `--rebuild-ledger`, que refaz o registro pela busca sem criar nada.
  - `--dry-run` só lê. Uma falha é tentada de novo com backoff, relida depois da escrita e, se persistir, fica pendente para o próximo sync, sem derrubar o comando do OXE.
- **Correções do planejamento de uma fase real com chaves do Jira:**
  - `spec add criterion` (e `spec amend`) escreve pelas colunas do cabeçalho. Na tabela `| ID | Critério | Risco | Como verificar |`, o verify ia para Risco e "Como verificar" ficava vazio. Agora `--risk` preenche a coluna Risco e é obrigatório quando ela existe, e uma coluna que o comando não preenche faz o comando falhar com o nome dela.
  - `program phase edit --add-acceptance/--add-requirements` aceita uma fase em `planning` enquanto nenhuma tentativa rodou (só `program start`). Se a fase já tem plano, avisa para cobrir o critério e rodar o lint de novo. Depois da primeira tentativa, o caminho continua sendo o CR.
  - OXB-030 ignora chaves de item do ALM (`OXE-104`, `CODE-8`, `AB#123`): o "104" de "(OXE-104)" deixou de ser tratado como status HTTP que o teste de aceite precisava exercitar.
- **Decisões → ADRs:** um único registro de decisões (`.oxe/program/decisions.ndjson`) para os IDs do DISCUSS (D-NN) e das fases (D-F2-n), publicado como ADRs versionados em `docs/adr/` (um arquivo por decisão: status, contexto, decisão, alternativas recusadas, consequências, evidência; mais o índice `README.md`). Novos: `decision add --context/--consequences/--supersedes`, `decision status <id> active|superseded|retired --reason`, `decision import` (tabela do DISCUSS.md, mesmos IDs) e `decision publish [--out]`. Cada mudança republica os ADRs, preservando o texto escrito fora dos marcadores; `adr: false` desliga. O `plan lint` avisa tarefa que cita decisão substituída ou aposentada.
- **Gate de release:** as exigências por versão do `doctor --release` (relatório de runtime real, scorecard de 2 projetos reais, eval de workflow) liam um campo que o manifesto não grava e nunca rodavam; agora leem `versions.rootPackage.version`.
- **CLI:**
  - `doctor --migrate-config` (OXB-100);
  - `--json-errors`, um envelope tipado com código de saída fixo por tipo (OXB-133, `docs/cli-errors.md`);
  - `state validate|sync` (OXB-121);
  - `guards install` (OXB-119).

### F1/F2 do OXESpace 1.5.0 (OXB-031–096, 147–166)
Este bloco reúne retomada e pausa, verify com timeout do config, dry-verify em paralelo e em lote, cadeia de PRs empilhados, `promote --tasks`, scratch por tarefa, config local, escopo de teste por tarefa, emendas de spec, standing criteria, signal de HML e deploy gate, entre outras. A lista completa, com a evidência de cada item, está no BACKLOG.

### Notas de migração
- `runtime.provider.maxTurns` agora é **teto**, e cada tarefa recebe os turnos do seu tamanho. Para o comportamento antigo, use `execute.turns` com o mesmo valor em S, M e L.
- O `doctor --release` exige `.oxe/release/eval-report.json`, gerado por `oxe-cc eval workflow plan.md --self-test --write-report`.
- Com um `.oxe/SYSTEM-DESIGN.md` presente, o close ganha o gate `design_drift`; desligue com `design_drift: false`.
- `oxe-cc plugins <subcomando desconhecido>` sai com 2.
- Rode `oxe-cc doctor --migrate-config` no projeto para ver as notas.

---

## [1.21.1] — 2026-11-04

### P0 da auditoria do OXESpace 1.5.0 (TECH LEAD, `docs/oxespace-1.5/BACKLOG.md`)

Esta versão corrige o que mais custou e travou o TECH LEAD na F1 da 1.5.0, run `oxe-run-mw28b0n9-3s0gda`. Cada correção vem com um teste que reproduz a evidência dele (`tests/oxe-1211-p0.test.cjs`).

- **O grafo é projeção do plano (OXB-053/052):**
  - o compile grava o hash do PLAN.json, do PLAN.md, da SPEC e do pack, e o `execute` **recompila sozinho** quando algo mudou, sem refazer tarefas `done`;
  - o checkpoint usa o escopo atual da tarefa (grafo + plano) e acusa (`checkpoint_incomplete`) qualquer arquivo do escopo que ficou fora do commit.

  Na F1, um CR mudou a T4 depois do compile, e o checkpoint gravou 1 de 4 arquivos. O execute ainda refez tarefas prontas (US$ 9,52).
- **A verificação do critério só na tarefa que o completa (OXB-053/046):**
  - o "Como verificar" de um critério entra só no verify da última tarefa dele; com várias tarefas terminando em paralelo, a verificação fica no verify da fase;
  - o `plan lint` mostra onde cada critério é verificado e avisa quando o verify de uma tarefa intermediária roda o teste de aceite do critério.

  O teste do A4, que confere todos os diálogos do `src/`, rodava em T8 e T9 e falhou 12 vezes (US$ 37,52).
- **Dependência externa não é gate humano (OXB-047):**
  - `blocked_by` trava só a própria tarefa, como `external_dependency`, sem gate pendente que bloqueie o preflight da run;
  - os gates antigos dessas tarefas são ignorados pelo preflight;
  - `kind: verify_only` / `external_delivery` roda só o verify, sem agente e sem custo, e conclui com `completed_by: verify_only`;
  - o compile consulta o GitHub (`gh pr view`) e destrava refs `owner/repo#n` já mergeadas (`external_dependency_check: false` desliga).
- **Um único scrub de ambiente (OXB-042):** os filhos do executor (CLI, ferramentas, verify, gates) não herdam mais `OXESPACE_*` nem variáveis com `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `CREDENTIAL` ou `PRIVATE_KEY`.
  - O adapter `claude` mantém só as credenciais do próprio provider.
  - O `config.json` aceita `env_scrub` (regex extras) e `env_allow` (nomes).
  - O `doctor --project` lista o que será removido.
- **Isolamento inplace e `--wave` real (OXB-051):**
  - quando uma tarefa falha de vez, a tentativa é guardada (`.oxe/runs/<run>/attempts/<task>-failed/`: patch e arquivos novos) e o escopo dela é restaurado antes da próxima tarefa;
  - arquivos que já estavam alterados antes do execute nunca são tocados (`isolate_failed_attempts: false` desliga);
  - cada tentativa falha tem seu log (`attempts/<task>-<n>.log`);
  - `runtime execute --wave N` roda só a onda N.
- **Retrabalho explícito:** um CR `defect` ou `spec_gap` reabre as tarefas impactadas (`done` → aberta, com histórico em `reopened`), e `oxe-cc plan reopen Tn` faz o mesmo à mão. Como o execute recompila a partir do plano, refazer uma tarefa passa a exigir reabri-la.
- **Scorecard honesto (OXB-054):** a 1ª tentativa é medida por tarefa, sobre todas as execuções da run. Uma tarefa que falhou, mesmo que depois tenha passado ou sido fechada à mão, conta como falha. As entregas externas ficam fora da taxa e aparecem à parte no `sample`.

---

## [1.21.0] — 2026-11-03

Esta versão consolida a 1.19 e a 1.20, que não foram publicadas, e acrescenta a 1.21. O objetivo é levar o OXE de "não mente sobre o que está pronto" para uma **maturidade medida**: aplicações de várias fases, corrigidas por um caminho único, dentro do orçamento e coerentes com as regras do repositório. Tudo foi validado construindo o OxeVoice 1.5 (F1) no oxespace e dois projetos de referência reais. Os 30 achados (OXB-001 a 030) estão em `docs/oxevoice/BACKLOG.md`.

### Programa por fases e aceite congelado (1.19)

- **Programa por fases:** `runtime program init|start|close|status` leva o `ROADMAP.md` ao `PROGRAM.json`. O gate de fase exige verify, regressão das fases fechadas (`reg-<fase>-*`) e os contratos de exports do pack, e termina com o commit local da fase. O prompt das fases seguintes recebe as interfaces das fases fechadas.
- **`PLAN.json` canônico** (`oxe/schemas/plan.schema.json`, validador próprio): `oxe-cc plan lint [--dry-verify]`. O dry-verify roda o comando efetivo segmento a segmento e separa o vermelho certo do comando quebrado.
- **Aceite congelado:** os testes de aceite são escritos pelo planner e congelados por hash no compile. O executor não pode escrevê-los, e o verify reprova com `acceptance_tampered`, `acceptance_missing` ou `proof_not_executed` (o teste nomeado precisa ter rodado).

### Dossiê vivo, ciclo de correção e retomada (1.20)

- **Dossiê por fase** (`runtime dossier`): `context`, `architecture`, `techspec` com Prova, `plan` com diário e handoff, `decisions` e `notes`. O texto humano é preservado entre marcadores, e o dossiê aponta drift de arquitetura e prova não executada. O `STATE.md` passa a ser uma projeção.
- **Change requests** (`runtime feedback --class defect|spec_gap|constraint|new_scope`): toda pushback entra em `changes.ndjson`.
  - Defeitos reabrem a fase.
  - Uma emenda de SPEC é versionada.
  - Uma restrição vira `policy_rules`.
  - **Um CR só fecha quando um teste congelado com `resolves` fica verde.**
- **Sign-off de UAT** (`runtime signoff`), além de `program close --defer-signoff --by --risk` com o risco registrado.
- **Retomada robusta:**
  - **retry informado:** a nova tentativa recebe o comando, o motivo e a saída da falha;
  - **régua de suspeita:** duas falhas idênticas param a tarefa;
  - **checkpoint e rollback:** `--checkpoint-commits` faz commit por tarefa, e `runtime rollback --task Tn` volta ao checkpoint;
  - **lease do journal:** um dono morto vira `interrupted`, que é retomável;
  - **gate por tarefa:** `gate` e `blocked_by` no PLAN.json.

### Maturidade operacional (1.21)

- **Gates do projeto** (`phase_gates`): typecheck, lint, a suíte de governança do repositório e a CI (`runtime ci --attach <run>`) rodam uma vez no verify da fase.
  - Um gate vermelho abre um CR com a saída, e o CR fecha quando o mesmo gate fica verde.
  - O `program close` exige os gates verdes.
  - O executor recebe `## Regras do repositório`: as `policy_rules`, as diretivas de AGENTS.md/CLAUDE.md e os títulos dos testes de governança.
- **Execução honesta e com orçamento:**
  - **Turn limit verificado:** quando a tentativa esgota os turnos depois de escrever no escopo, o runtime roda o verify antes de classificá-la, em vez de descartar trabalho pronto.
  - **Orçamento por run:** `--budget-turns`/`--budget-usd`/`--max-retries` ou `budget` no PLAN.json. O ledger soma entre execuções; o scheduler para entre tentativas (`BudgetExhausted`) e limita a próxima aos turnos que restam.
  - **`done` persistido:** `done`/`done_at`/`done_commit` vão para o PLAN.json, e `oxe-cc plan done Tn` marca uma tarefa à mão.
  - **Convenção de commit:** `commit_convention` (template, pattern, trailers, `commit` por tarefa) mais o trailer `OXE-Task: Tn`.
  - **Um validador só:** o `plan lint` e o preflight usam o mesmo validador de pack, e o lint antecipa os gaps de racionalidade do preflight. `symbols` só é exigido para arquivo de código.
- **CLI previsível:** comandos de runtime não recriam arquivos apagados do `.oxe/`, e o `--json` deixa só JSON no stdout (decoração vai para o stderr).
- **Ambiente e incerteza:**
  - `oxe-cc doctor --project` e o preflight comparam a máquina com `engines`, `.nvmrc`, `packageManager` e com o engines das dependências diretas no lockfile (`project_env_check: warn|false`).
  - Uma tarefa `kind: spike` responde uma pergunta técnica com evidência e vira a decisão `D-SPIKE-Tn`.
- **Coesão entre fases:** o handoff "O que a próxima fase deve saber" de cada fase fechada entra no prompt das fases seguintes.
- **Maturidade medida** (`runtime scorecard [--since]`): mede 1ª tentativa, turnos pagos depois de concluir, estouro de orçamento, CR fechado sem prova e CR aberto depois do verde. **A partir da 1.21.0, o `doctor --release` exige o scorecard de 2 projetos reais**, cada um com ≥ 10 tarefas e dentro das metas.
  - `scripts/reference-projects.cjs` constrói os projetos de referência (`ledger-api`, `mdlint`) de ponta a ponta com executor real e oráculo independente.
- **Critério coberto pelo teste (OXB-030):** o `plan lint` cobra que os termos verificáveis de um critério (códigos 1xx–5xx, `code spans`, "literais") apareçam no teste congelado que o prova. Surgiu de um falso verde real no projeto de referência `ledger-api`, pego pelo oráculo independente.
- **Projetos de referência reais:** `ledger-api` e `mdlint`, com 2 fases cada e 20/20 tarefas na 1ª tentativa (78 turnos, US$ 3,58), oráculo verde e scorecard dentro das metas (`release-evidence/`). O modo offline `--solution` (`npm run test:reference-projects`, no `npm test`) roda o fluxo inteiro com a solução conhecida no lugar do modelo: a cada execução, valida que os testes congelados do planner e os oráculos estão corretos.
- **Auditoria de dependências:** as vulnerabilidades altas de desenvolvimento foram corrigidas (`npm audit fix`). O gate de CI passa a separar produção (`npm audit --omit=dev`, bloqueia em qualquer nível) de desenvolvimento (`--audit-level=high`). As 9 moderadas restantes estão em ferramentas de lint e cobertura e só se corrigem com upgrade major.
- **Segurança:** o dispose do `git_worktree` desfaz os links que saem do worktree antes do `worktree remove --force`, para que a remoção nunca apague o diretório real. O dry-verify e os gates de close não herdam `NODE_TEST_CONTEXT`, que dava falso verde.

---

## [1.18.0] — 2026-10-31

### Executor nativo do host e contexto do nó

- **ExecutorAdapter (`claude` | `http`):** o loop de tools da 1.17 é comum aos adapters, que só fornecem a
  função de completion. Continuam valendo a allowlist, a contenção de caminhos e a regra `no_tool_call` ⇒ falha.
- **Adapter `claude`:** roda um `claude -p --output-format json --tools ''` por turno, sem ponte HTTP,
  porta nem API key. O processo morre ao fim de cada turno. Resposta fora do protocolo é retentada
  até 2 vezes e depois falha como `llm`. No Windows, `.cmd` é suportado via `cmd.exe` verbatim.
- **`runtime execute --adapter claude|http`:** sem flag, usa o adapter persistido; senão `http` se houver
  API key; senão `claude` se o binário for detectado. `--api-key` só é exigido para `http`.
  `runtime providers` lista os adapters detectados (`--json`).
- **NodeExecutionContext:** o prompt do nó passa a levar:
  - o corpo da tarefa no PLAN;
  - o contrato do IMPLEMENTATION-PACK;
  - o FIXTURE-PACK;
  - o snapshot dos arquivos do escopo;
  - o `git status`;
  - as lições.

  Cada seção tem orçamento e truncamento explícito.
- **Telemetria `ExecutorUsage`:** turnos, tool calls por ferramenta, custo e motivo da falha por tentativa.
  Vai para a tabela *Executor usage* do RUN-SUMMARY.
- **Verify:** código do produto que lê `.oxe/` (artefato interno, fora do git) reprova o contrato
  com `oxe_internal_reference`. Isso fecha um falso verde visto no benchmark.
- **`scripts/e2e-linkly.cjs --real`:** benchmark real com oráculo de referência independente.
  Resultado: replay do linkly com 8/8 tarefas na 1ª tentativa, US$ 1,66 (1.17: US$ 4,88).

---

## [1.17.1] — 2026-10-31

### Achados do benchmark real da 1.17

O benchmark ponta a ponta da 1.17.0 (replay do linkly: 8/8 tarefas na 1ª tentativa,
oráculo independente 18/18, US$ 4,88 contra US$ 6,57 da 1.16) expôs estes defeitos, agora corrigidos:

- **Falso vermelho:** o tipo do check passa a vir do comando executado, ignorando argumentos entre aspas.
  Um `node -e "…'node --test'…"` deixa de exigir relatório de teste.
- **Suíte velha:** `runtime verify` recompila a suíte persistida quando o hash de SPEC/PLAN muda
  e emite o evento `VerificationSuiteRecompiled`. Não é mais preciso apagá-la à mão de `.oxe/runs/<id>.json`.
- **Contrato do IMPLEMENTATION-PACK verificado:** os `exact_paths` de tarefas `mutating` viram checks `contract`.
  Um arquivo ausente falha a run com `files_missing`.
- **Gate de cobertura explicável:** o resumo traz `checks_without_evidence`, e o merge gate nomeia os checks que faltam.
- **Manifest** carrega o motivo da falha (`error`) de cada check.
- **Re-verify verde** de uma run executada restaura `completed` em vez de deixá-la `running`.
- **Preflight:** os modos `read_only`, `verify-only` e equivalentes são normalizados para `not_applicable`.
- **parsePlan:** descarta spans de escopo que não são caminhos e junta todas as linhas `Comando:` da tarefa.
- **Router:** com PLAN pronto, sugere `execute` mesmo sem mapas do codebase (projetos greenfield).

---

## [1.17.0] — 2026-10-31

### Integridade da verificação: sem falso verde

Um teste ponta a ponta real (app "linkly") mostrou o runtime reportando 18/18
checks aprovados com tarefas falhadas e um arquivo de teste inexistente. Esta
versão fecha essas causas e mede o falso verde com um oráculo independente
(`npm run test:e2e-linkly`: 50% na 1.16.0, 0% agora).

- **Verify baseado em testes executados** — arquivo de teste ausente, zero
  testes executados ou ausência de relatório de teste reprovam o check; parsers
  para TAP/node, jest, vitest, mocha, pytest e JUnit. "Como verificar" em prosa
  vira check manual: a run fica `partial` e o merge gate bloqueia com motivo.
  Cobertura de evidência conta só checks executados.
- **Escopo de mutação** — `parsePlan` lê `Arquivos`, `Arquivos alvo` e
  `Arquivos prováveis`; tarefa mutável sem escopo roda em série e emite
  `PolicyWarning`. O Gap B só anexa trechos que parecem comando.
- **Eventos e estado** — cada evento é gravado uma vez com id estável; logs
  antigos duplicados são deduplicados. ACTIVE-RUN recebe status, falhas e
  `canonical_state` ao fim do execute; STATE.md e VERIFY.md são projetados em
  blocos `<!-- oxe:runtime:begin/end -->` que preservam o texto manual.
- **Executor** — tools fora da allowlist da tarefa são negadas; caminhos ficam
  contidos no workspace; resposta só em texto numa tarefa que precisa escrever
  é falha; URL da API preserva `/v1`; comandos no Windows usam
  `cmd.exe /d /s /c` sem reescrita de aspas.
- **Scheduler** — abort por timeout preserva o que foi concluído; `recover`
  aceita runs pausadas, bloqueadas, abortadas ou falhas; gate aprovado não é
  pedido de novo; workspace é liberado pelo provider que o alocou.
- **Preflight de fixtures** alinhado ao gate do plano (`task_id` em lista,
  `not_applicable`, `requires_fixture:false`).
- **Instalação** — flag `--claude`; VSIX escolhido por semver; extensão VS Code
  só quando a integração VS Code é pedida; doctor detecta `.claude/` local;
  `*.vsix` fora do git.
- **CI** — job Windows para o runtime e o e2e-linkly.

---

## [1.16.0] — 2026-07-18

### Segurança, pacote verificável e engenharia de release

Esta versão consolida o OXE-BUILD como framework multi-runtime orientado por
evidências, com foco em segurança de subprocessos, consumo real do pacote,
qualidade mensurável e releases reproduzíveis.

- **Executor seguro e multiplataforma** — invocações de `npm` e `npx` foram
  centralizadas com argumentos estruturados e `shell: false`, incluindo
  resolução explícita de `npm-cli.js`/`npx-cli.js` no Windows e testes contra
  payloads hostis.
- **Portabilidade comprovada em Windows e Linux** — resolução de caminhos
  Windows usa semântica `win32` mesmo quando simulada em outro host; mocks do
  Azure CLI e instalações globais de agentes passaram a ser herméticos, e o
  OpenCode recebe também a entrada raiz `oxe.md`.
- **CLI modular** — dispatch de comandos separado em registry e handlers
  testáveis, reduzindo o acoplamento do entrypoint sem alterar a interface
  pública.
- **Pacote validado como um consumidor real** — o gate cria o tarball, instala
  em projeto temporário limpo e exercita CLI, SDK, runtime e compilação
  TypeScript.
- **npm workspaces e lockfile único** — raiz, runtime e extensão usam a mesma
  resolução; o lockfile aninhado obsoleto do runtime foi removido.
- **SDK types gerados pelo TypeScript** — `index.d.ts` passa a ser emissão
  determinística de `index.types.ts`, com gate de drift e validação da ABI
  pública.
- **Coverage ratchet** — pisos globais e de módulos críticos são executáveis e
  não podem ser reduzidos abaixo do baseline versionado.
- **Extensão validada no VS Code real** — o Extension Host 1.95.3 comprova a
  ativação e o registro observável dos 13 participantes OXE; o VSIX é gerado
  por uma versão fixa do `vsce`.
- **Supply chain endurecida** — GitHub Actions fixadas por SHA, Dependabot,
  permissões mínimas, actionlint, tag vinculada à versão e GitHub Release
  condicionada ao build do VSIX.
- **Publicação npm manual nesta release** — a criação da tag gera validação e
  GitHub Release, mas não executa `npm publish`; a promoção ao registry fica
  sob controle explícito do mantenedor.
- **Quality telemetry** — relatório JSON/Markdown exige os 10 gates, rejeita
  gates ausentes, duplicados ou inesperados e invalida evidências antigas.
- **README redesenhado** — proposta de valor, quickstart, fluxos Nano/Standard/
  Full, runtime-first, adoção por equipes e métricas verificáveis agora formam
  uma narrativa única e orientada ao uso.

### Evidência da release

- 10/10 quality gates aprovados.
- 384/384 testes do runtime e mais de 600 testes raiz.
- 30/30 cenários smoke, runtime real, recovery e multiagente.
- Cobertura: 83,06% lines/statements, 92,63% functions e 61,77% branches.
- `npm audit`: 0 vulnerabilidades.
- Tarball npm: 506 arquivos; VSIX: 13 participantes ativados em host real.

## [1.15.0] — 2026-06-27

### `.oxe/` enxuto no install + mapa vivo de artefatos

Resposta ao feedback de que a quantidade de pastas criadas no install era grande
demais e dificultava entender o fluxo versus o que de fato foi/será criado.

- **Lazy scaffolding** — `oxe-cc init-oxe`/`install` agora cria só o núcleo
  essencial: `.oxe/STATE.md`, `.oxe/config.json` e `.oxe/README.md` (legenda
  gerada). As ~13 subpastas e os arquivos operacionais (`codebase/`,
  `capabilities/`, `investigations/`, `global/`, `sessions/`, `memory/`,
  `runs/`, `EXECUTION-RUNTIME.md`, `ACTIVE-RUN.json`, `OXE-EVENTS.ndjson`,
  `CHECKPOINTS.md`, `CAPABILITIES.md`, `INVESTIGATIONS.md`, …) passam a nascer
  **sob demanda**, no primeiro uso do workflow correspondente.
- **Catálogo único de artefatos** (`bin/lib/oxe-artifact-catalog.cjs`) — fonte
  da verdade que descreve cada artefato do `.oxe/` (path, propósito, origem,
  grupo) e da qual derivam legenda, mapa e docs (uma definição, três saídas).
- **`oxe-cc map`** — mapa vivo anotado do `.oxe/`: o que já existe, o que está
  disponível sob demanda e o estado de cada item (`✓ ativo · ◦ vazio ·
  ⚠ desatualizado · · sob demanda`). `oxe-cc map --json` (`oxeMapSchema: 1`)
  para hosts; exposto no SDK como `artifacts.buildMapModel` / `renderLegend`.
- **`.oxe/README.md` gerado** — legenda local de todos os artefatos, escrita no
  init e **re-renderizada por `oxe-cc doctor`** (documentação forte sem pastas
  vazias).
- **STATE.md enxuto** — template reduzido de 141 → ~30 linhas (fase, sessão,
  próximo passo, decisões, bloqueios). As ~15 seções opcionais foram movidas
  para `oxe/templates/STATE-REFERENCE.md`, anexadas sob demanda.
- **`doctor`/`status` sem falsos-positivos** — a ausência de artefato lazy agora
  é estado normal (não gera aviso); inconsistências reais (STATE diz X mas o
  artefato não existe) continuam detectadas.
- Novos contratos documentados em `docs/INTEGRATION.md`; testes em
  `tests/oxe-map.test.cjs` + contrato `map --json` em
  `tests/oxe-integration-contracts.test.cjs`.

## [1.14.0] — 2026-05-30

### Contratos de integração para hosts — reatividade + dashboard embutível

Aditivo — nenhum contrato existente muda. Complementa o 1.13.0 (`status --json --summary`, `agentSkills`) para hosts como o OXESpace embutirem o oxe-cc de forma reativa e visual.

- **`oxe events --tail [N] --json [--since <evt_id>] [--session <s>]`** — projeção read-only e versionada (`oxeEventsSchema: 1`) do log append-only `.oxe/OXE-EVENTS.ndjson`: `{ summary: { total, byType, lastEvent }, events: [...] }`. `--since` devolve só os eventos novos desde um `event_id` conhecido (leitura incremental). Reusa `operational.readEvents`/`summarizeEvents`. Um host normalmente observa o arquivo e chama `status --json --summary`; este comando é a forma documentada de ler o tail sem reparsear tudo.
- **`oxe dashboard --json`** — emite **uma linha** estável e versionada (`oxeDashboardSchema: 1`) com `{ url, port, readOnly, projectRoot }` assim que o servidor sobe, e **continua servindo**. Permite a um host capturar URL/porta de forma robusta e embutir o dashboard num webview, em vez de raspar o banner humano. Combine com `--no-open --port 0` para porta efêmera.
- **`dashboard --port 0`** agora seleciona uma porta efêmera de verdade (antes caía no default `4173`).
- **`docs/INTEGRATION.md`** — contrato estável para hosts: `status --json --summary`, `agentSkills`, schema do `OXE-EVENTS.ndjson`, `events --json` e `dashboard --json`; marca o que é estável vs experimental.

---

## [1.13.0] — 2026-05-29

### Contratos de integração para hosts (IDEs, OXESpace)

Aditivo — nenhum contrato existente muda. Facilita hosts consumirem o oxe-cc.

- **`oxe status --json --summary`** — projeção compacta e versionada (`oxeSummarySchema: 1`) com `workspaceMode, phase, healthStatus, activeSession, nextStep, cursorCmd, reason, eventsCount, warningsCount` + um `agentSkills` compacto. Troca ~150KB do status completo por <1KB para o "glance" que um host precisa.
- **`agentSkills` no `status --json`** e **`agentSkillsReport(target)` no SDK** (`health.agentSkillsReport`) — status das skills `/oxe-*` por agente no workspace (`copilot-vscode`, `codex`, `copilot-cli`): `detected/skillsInstalled/skillsPath/status/issues`. Permite a um host detectar skills ausentes e oferecer instalação **antes** de lançar o agente (resolve o "Failed to load N skills").
- **SDK**: `health.buildStatusSummary(report)` e `health.agentSkillsReport(target)` exportados + tipados em `lib/sdk/index.d.ts`.

---

## [1.12.0] — 2026-05-12

### Agent Mode, Swarm Mode, Memory Kernel & Learning Kernel

Esta release transforma o OXE em um sistema autônomo orientado a objetivos. O usuário escreve `/oxe <objetivo em linguagem natural>` e o Conductor decide automaticamente o fluxo, os agentes e a estratégia de execução — sem precisar escolher comandos manualmente.

#### Conductor Agent (`oxe/workflows/conduct.md`)

- novo workflow que age como ponto de entrada para objetivos de implementação em linguagem natural
- classifica complexidade em três scores: simples | médio | complexo
- recupera memória relevante das 5 camadas (runtime_state, session_memory, project_memory, lessons, observations)
- seleciona personas aplicáveis por `intent_tags` (backend → executor/architect, frontend → ui-specialist, storage → db-specialist, etc.)
- decide automaticamente **Agent Mode** (simples/médio) ou **Swarm Mode** (complexo/multi-domínio)
- `oxe/workflows/oxe.md` e `route.md` atualizados: objetivos de implementação redirecionam para `conduct.md`

#### Agent Mode (`oxe/workflows/agent-mode.md`)

- Conductor age sozinho com a persona selecionada para objetivos de 1–2 domínios e ≤ 8 arquivos
- grava `AGENT-SESSION.json` em `.oxe/agent/` com intent, skills, tool_calls e reconciliação
- discovery mínimo antes de mutar: confirma write_set, padrões, riscos
- se write_set exceder threshold para `intent_score=simples`, eleva automaticamente para Swarm Mode
- `RECONCILIATION.md` gerado ao final com arquivos alterados e objective_satisfied

#### Swarm Mode (`oxe/workflows/swarm-mode.md`)

- orquestração de 5 papéis em pipeline controlado: Scout → Coordinator → Builder(s) → Reviewer → Verifier
- **Scout** (`oxe/workflows/swarm/scout.md`): produz CODEBASE-MAP.md, PATTERNS.md, RISK-MAP.md, FILE-CANDIDATES.json e TEST-CANDIDATES.json antes de qualquer mutação
- **File Ownership** (`FILE-OWNERSHIP.json`): cada Builder declara `write_set`; conflitos → Coordinator serializa em waves sequenciais
- **Board** (`oxe/workflows/swarm/board.md`): BOARD.md e BOARD.json atualizados em tempo real por fase
- **Quality Gates** automáticos: arquivo high-risk → gate humano; cobertura abaixo de threshold → gate auto
- **Reviewer**: produz `.oxe/swarm/reviews/<task_id>-REVIEW.md` por tarefa antes de integração
- **Verifier/Integrator**: FINAL-INTEGRATION.md com evidências completas e VERIFY.md atualizado
- novo schema `oxe/schemas/swarm-run.schema.json` (JSON Schema Draft-07) para SWARM-RUN.json

#### Memory Kernel (`oxe/workflows/memory.md` + `bin/lib/oxe-memory-kernel.cjs`)

- ativa o modelo de 4 camadas de memória já definido em `oxe-operational.cjs:2364`
- `retrieveMemory(projectRoot, intentTags, phase, objective)`: filtra fragmentos por relevância e phase; ranking por score (tag match, impacto, frequência)
- `saveContextPack()`: grava context pack em `.oxe/agent/MEMORY-INJECTIONS.md` ou `.oxe/swarm/DECISIONS.md` + snapshot auditável em `.oxe/memory/retrieved/<phase>.md`
- novos templates: `REPO-MEMORY.template.md` (decisões cross-session, pitfalls, preferências, padrões validados) e `MEMORY-INDEX.template.json`

#### Learning Kernel (`oxe/workflows/distill.md` + `bin/lib/oxe-learning-kernel.cjs`)

- detecta padrões automaticamente ao final de cada run: blocker_pattern, success_pattern, anti_pattern, file_conflict_pattern, integration_gap, scope_expansion
- atualiza `LESSONS.md` com dedup correto (Frequência++ para lições repetidas, não duplicatas)
- popula `lessons-metrics.json` com `outcomes` e `success_rate` por lição; deprecação automática se `success_rate < 0.5` e `apply_count >= 3`
- enfileira skill candidatas em `.oxe/learning/PROMOTION-QUEUE.md` quando padrão aparece em 2+ runs
- atualiza `REPO-MEMORY.md` com decisões arquiteturais e pitfalls novos

#### Skill Runtime (`bin/lib/oxe-skill-loader.cjs`)

- `loadSkill(id, projectRoot)`: resolve por ordem de precedência projeto → capabilities → global
- `listSkills()`: enumera active/proposed/archived/global por diretório
- `selectPersonasForIntent(intentTags, projectRoot)`: mapeia intent_tags para personas primárias e secundárias
- `recordSkillsLoaded()`: grava snapshot das personas ativas em `.oxe/agent/SKILLS-LOADED.json`

#### Event Bus (`bin/lib/oxe-event-bus.cjs`)

- `OXE-EVENTS.ndjson` passa a ser efetivamente populado durante runs (antes: schema definido, nunca emitido)
- helpers tipados: `emitRunStarted`, `emitWorkItemCompleted`, `emitWorkItemBlocked`, `emitRunCompleted`, `emitGateRequested`, `emitGateResolved`, `emitLessonPromoted`, `emitRetroPublished`
- `readEvents(projectRoot, filters)`: leitura com filtro por `run_id`, `type`, `since`

#### Runtime contracts

- `workflow-runtime-contracts.json` atualizado com contratos semânticos para todos os 5 novos workflows (conduct, agent-mode, swarm-mode, memory, distill)
- `help.md` router: nova entrada de prioridade máxima para objetivos de implementação → `/oxe <objetivo>` → Conductor

#### Templates adicionados

- `.oxe/templates/AGENT-SESSION.template.json`
- `.oxe/templates/swarm/SWARM-RUN.template.json`
- `.oxe/templates/swarm/FILE-OWNERSHIP.template.json`
- `.oxe/templates/swarm/BOARD.template.md`
- `.oxe/templates/swarm/QUALITY-GATES.template.md`
- `.oxe/templates/REPO-MEMORY.template.md`
- `.oxe/templates/MEMORY-INDEX.template.json`
- `.oxe/templates/learning/CANDIDATES.template.ndjson`
- `.oxe/templates/learning/PROMOTION-QUEUE.template.md`

---

## [1.11.0] — 2026-05-06

### Spec Lifecycle Automation & CLI Gaps

Esta release fecha os gaps de adoção identificados na análise de maturidade v1.10.0, com foco em automação do ciclo de vida do SPEC, configuração de provider e tolerância de formato no parser de planos.

#### Automação do ciclo de vida (SPEC.md)

- nova função `applySpecChecklistSync` em `oxe-operational.cjs`: ao executar `runtime project` com um run `completed`, marca automaticamente `**DoD Wave N:**` e seções MVP/v0.x.x do checklist no `SPEC.md` com `[x]`
- v1.0.0 checklist não é marcado automaticamente — requer sign-off explícito
- exportada no módulo para testes de integração e uso programático

#### CLI — `runtime execute`

- novo flag `--agents-plan <path>`: override explícito para localização do `plan-agents.json`, com prioridade sobre detecção automática por sessão e raiz do projeto
- novo flag `--api-key-env <VAR>`: lê API key de variável de ambiente nomeada em vez de `OXE_LLM_API_KEY`
- novo subcomando `runtime configure`: wizard interativo que persiste `baseUrl`, `model`, `apiKey` em `.oxe/config.json` (seção `runtime.provider`)

#### Provider LLM auto-wired

- `createExecutionContext` passa a instanciar `PolicyEngine.fromConfigFile()` automaticamente quando `.oxe/config.json` contém seção `runtime.policy`
- `loadRuntimeProviderConfig` / `saveRuntimeProviderConfig` exportados de `oxe-operational.cjs`
- health checks de `runtime.provider` e `runtime.policy` adicionados ao `oxe-cc status`

#### Parser de planos — tolerância de formato (Gap E)

- `parsePlan` agora aceita `**Verificação:**`, `**Verify command:**` e `**Verification:**` além do formato `Verificação:` sem negrito
- planos gerados por LLM com markdown bold deixam de silenciosamente omitir verify commands

#### Spec-criteria enrichment (Gap B)

- `compileExecutionGraphFromArtifacts` extrai comandos backtick dos campos `howToVerify` dos critérios de aceite da SPEC e os anexa a `node.verify.command` quando ausente no PLAN

#### Testes e benchmark

- novo `test:runtime-llm` (`scripts/test-runtime-llm.cjs`): valida `LlmTaskExecutor` end-to-end com LLM real; skipa automaticamente quando `OXE_LLM_API_KEY` não está definido
- novo `benchmark:autonomy` (`scripts/benchmark-autonomy.cjs`): 5 fixtures de referência (simple → medium → parallel), mede taxa de compilação→execução→verify sem intervenção; saída em `.oxe/release/benchmark-autonomy-report.json`
- novos testes: `gap-spec-enrichment.test.cjs` (5 casos) e `gap-spec-checklist-sync.test.cjs` (4 casos)

## [1.10.0] — 2026-05-05

### Operational Maturity

Esta release amplia a prova operacional do OXE para cenários mais próximos de uso real, sem abrir novos comandos públicos.

- `test:runtime-real` passa a cobrir cenários multi-wave, multi-file, gate pendente, verify parcial e promoção bloqueada por ausência de evidência técnica
- `workspace-merge-report.json` passa a carregar `evidence_refs`, `diff_summary`, arquivos aplicados, status de verify pós-execução e próxima ação operacional por task
- `status`, `runtime status` e `runtime agents status` expõem merge readiness, blockers e próxima ação multi-agent de forma mais direta
- `workspaceMode: product_package` deixa de marcar `contextQuality` como crítico quando não há ciclo OXE ativo no próprio repositório do pacote
- smoke multi-runtime reforça Codex e Copilot VS Code com validação explícita de prompts/skills, manifesto e referências quebradas
- `doctor --release` passa a validar o conteúdo mínimo dos relatórios runtime-real e multi-agent-real da linha `1.10.0`
- `/oxe-spec` passa a ter contrato multimodal: imagens, screenshots e mockups enviados no chat devem virar `VISUAL-INPUTS.md/json`, anchors visuais e readiness bloqueante quando críticos para UI/fluxo

## [1.9.1] — 2026-05-04

### Multi-Agent Real

Esta release endurece a coordenação multi-agent sobre workspaces reais, sem abrir novos comandos públicos.

- multi-agent real passa a exigir workspaces isolados `git_worktree` para modos `parallel`, `competitive` e `cooperative`
- `runtime execute` valida `plan-agents.json` antes de iniciar agentes e usa `GitWorktreeManager` por padrão no caminho multi-agent
- novo artefato por run `.oxe/runs/<run_id>/workspace-merge-report.json` com worktrees, ownership, merge blockers e readiness
- `runtime agents status --json`, `status --json` e recovery passam a expor merge readiness, blockers, arbitration e worktrees órfãos
- novo `npm run test:multi-agent-real` gera `.oxe/release/multi-agent-real-report.json` usando repositório git temporário com worktrees reais
- `doctor --release` passa a exigir `multi-agent-real-report.json` em versões `>=1.9.1`

## [1.9.0] — 2026-05-04

### Runtime Real Maturity

Esta release eleva a maturidade prática do OXE com foco em prova determinística do ciclo real `spec -> plan -> execute -> verify -> status/doctor`, sem abrir novos comandos públicos.

#### Runtime real

- nova suíte `test:runtime-real` valida projetos representativos com executor mockado e sem chamada a LLM/API externa
- `runtime execute` passa a bloquear antes da mutação quando confiança, rationality packs ou gates não estão prontos
- `runtime verify` continua evidence-first e passa a ser validado dentro do fluxo real de execução

#### Release proof

- novo relatório obrigatório `.oxe/release/runtime-real-report.json`
- `doctor --release` passa a bloquear publicação quando a prova de runtime real estiver ausente ou falha
- novo `release:pack-check` valida o tarball npm em dry-run contra artefatos indevidos

## [1.8.3] — 2026-05-04

### Release readiness e higiene de publicação

Esta release consolida a linha `1.8.3` para publicação no npm com foco em consistência de versão, alinhamento documental e pacote distribuído mais limpo.

#### Publicação

- alinhamento da versão `1.8.3` entre manifesto raiz, runtime, extensão VS Code, README e changelog
- fechamento do gate oficial `doctor --release` para a linha atual
- preparação do pacote npm para sair sem drift entre versão publicada e documentação principal

#### Higiene do pacote

- exclusão dos arquivos `.vsix` históricos da extensão VS Code do tarball npm
- manutenção apenas do código-fonte da extensão dentro do pacote, evitando distribuir binários legados desnecessários

## [1.8.2] — 2026-04-30

### Fluxo inicial mais coerente e geração de `spec`/`plan` mais forte

Esta release fecha a linha de robustez do ciclo `install -> status/doctor -> /oxe -> spec -> plan -> execute -> verify` sem abrir nova superfície pública. O foco foi remover ruído operacional em projetos novos e aumentar a densidade executável dos artefatos que o OXE induz.

#### Fluxo operacional

- `install`, `status` e `doctor` passam a convergir em `/oxe` como próximo passo canônico para projetos recém-inicializados
- `doctor` e `status` deixam de tratar `IMPLEMENTATION-PACK`, `REFERENCE-ANCHORS` e `FIXTURE-PACK` como blocker primário antes de existir `PLAN.md`
- o relatório racional agora marca o estado sem plano como `não aplicável ainda`, sem contaminar o próximo passo
- instalações e desinstalações locais por runtime continuam simétricas, com inferência de artefatos locais preservada

#### Indução mais forte de SPEC e PLAN

- `SPEC.template.md` passou a exigir outcome observável, público-alvo, restrições técnicas, setup externo, conteúdo/fluxos obrigatórios e contratos esperados para o plano
- `PLAN.template.md` ganhou contrato operacional da solução, densidade operacional mínima, `symbols alvo`, `estado/fluxo coberto` e `fixture/anchor obrigatório` por tarefa
- `oxe/workflows/spec.md` agora força extração explícita de blocos de interface, conteúdo mínimo, interações, responsividade e acessibilidade em demandas de produto/app/UI
- `oxe/workflows/plan.md` agora endurece o gate de confiança `>90%` para tarefas mutáveis vagas e exige fechamento mais forte de interface, conteúdo, estado persistido, anchors e fixtures em apps/UI estáticos

#### Testes

- novo teste cobrindo o estado racional não bloqueante antes da existência de `PLAN.md`
- suíte focada de CLI/health atualizada para manter o comportamento novo estável

## [1.8.1] — 2026-04-30

### Hotfix — Gaps implementados no fonte TypeScript (não em arquivos compilados)

A v1.8.0 aplicou as 5 correções críticas diretamente nos arquivos `.js` compilados (`lib/runtime/`), que são sobrescritos a cada `npm run build:runtime`. Esta release porta todas as correções para o fonte TypeScript em `packages/runtime/src/`, tornando-as permanentes.

#### Correções portadas para TypeScript

- **`models/failure.ts`**: `FailureClass` agora inclui `'verify'` e `'llm'` como classes canônicas
- **`scheduler/scheduler.ts`**: `TaskResult` com campo opcional `completed_by`; `TaskExecutor.execute()` aceita `options?: { previousError? }`; `verifyNode()` importa e chama `verifyRun` da fonte TS; `executeNode()` repassa `options`; `requestGateForNode()` com warning quando manager ausente
- **`executor/built-in-tools.ts`**: `finishTask` handler + registro em `BUILT_IN_TOOLS`
- **`executor/action-tool-map.ts`**: `finish_task` injetado universalmente em `selectToolsForActions()`
- **`executor/node-prompt-builder.ts`**: parâmetro `options`, seção de retry context, instrução `finish_task`
- **`executor/llm-task-executor.ts`**: detecção de `finish_task`, `completed_by` no retorno, `turn_limit_exhausted` retorna `success: false`

#### Testes
- 542 testes passando (era 542 na v1.8.0, nenhuma regressão)
- 36 testes de gaps (gap1–gap5) todos passando contra o código compilado

---

## [1.8.0] — 2026-04-29

### Autonomous Execution — 5 Critical Gaps Resolved

Esta release eleva a autonomia do runtime de ~65% para ~85%+ em projetos de baixo a médio risco, tornando o OXE capaz de transformar um input bem estruturado em entrega verificada com mínima intervenção humana.

#### Gap 1 — GateManager Wiring
- `createExecutionContext()` exportada de `oxe-operational.cjs`: instancia `GateManager` real sempre que o runtime estiver disponível, eliminando o deadlock silencioso de `'gate-missing-manager'`
- `scheduler.js`: warning explícito quando `ctx.gateManager` ausente em vez de falha silenciosa
- Novo subcomando `oxe-cc runtime execute` com roteamento automático single-agent / multi-agent

#### Gap 2 — Verificação Inline após cada tarefa
- `Scheduler.verifyNode()`: executa o `verify.command` do nó logo após execução bem-sucedida, antes de emitir `WorkItemCompleted`
- Falha de verificação → tarefa reentrada no loop de retry com `failure_class: 'verify'`
- Falha de infraestrutura de verificação (comando inexistente, timeout) → não bloqueia progresso
- Eventos `VerificationStarted` / `VerificationCompleted` emitidos por tarefa (reducer já existia)

#### Gap 3 — Retry Inteligente com Contexto do Erro Anterior
- `node-prompt-builder.js`: seção "Contexto da tentativa anterior" injetada automaticamente nas tentativas 2+ com stderr/output truncado em 2000 chars
- `llm-task-executor.js`: aceita `options.previousError`; repassado para o prompt builder
- `scheduler.js`: `lastError` rastreado e propagado entre tentativas via `executeNode(options)`

#### Gap 4 — Sinal Autoritativo de Conclusão (`finish_task`)
- Nova tool built-in `finish_task` (idempotente) registrada em `BUILT_IN_TOOLS` e `ALL_BUILT_IN_SCHEMAS`
- `selectToolsForActions()`: `finish_task` injetada universalmente em todos os tipos de ação
- `node-prompt-builder.js`: instrução explícita de chamar `finish_task` ao concluir
- `llm-task-executor.js`: detecta chamada de `finish_task` → `completed_by: 'finish_task'`; turns esgotados sem `finish_task` → `success: false, failure_class: 'llm'`

#### Gap 5 — MultiAgentCoordinator Wiring
- `runRuntimeExecute()` exportada de `oxe-operational.cjs`: detecta `plan-agents.json` (sessão > raiz) e roteia para `MultiAgentCoordinator` (parallel/competitive/cooperative) ou `Scheduler` single-agent
- `oxe-cc runtime execute`: novo subcomando CLI com output formatado e exit code em falhas

#### Testes
- 5 novos arquivos de teste cobrindo cada gap: `gap1-gate-manager`, `gap2-inline-verify`, `gap3-retry-context`, `gap4-finish-task`, `gap5-multi-agent`
- Suite total: **543 testes passando**, 0 falhas

### Validation

- `node --test tests/*.cjs tests/*.test.js`
- `node bin/oxe-cc.js --version`

---

## [1.7.0] — 2026-04-23

### OXE-native Agent Catalog

- adicionada a fonte canónica `oxe/agents/` com agentes especializados para plan, execute, verify, debug, research, codebase mapping, integração, validação e UI
- o instalador multi-runtime agora distribui agentes OXE para Claude Code (`.claude/agents`) e Codex/Antigravity (`.agents/skills` / skills compatíveis), além dos comandos já existentes
- uninstall e smoke matrix passaram a validar e remover os agentes gerados pelo OXE

### Rational Execution Artifacts

- templates de `PLAN`, `IMPLEMENTATION-PACK`, `REFERENCE-ANCHORS`, `FIXTURE-PACK` e `SUMMARY` foram endurecidos com contratos goal-backward, write-set, símbolos, sequência mínima, rollback, fixtures e evidência
- `/oxe-plan`, `/oxe-execute`, `/oxe-verify`, `/oxe-debug`, `/oxe-forensics`, `/oxe-ui-spec` e `/oxe-ui-review` agora referenciam explicitamente os agentes e gates racionais compatíveis com runtime enterprise

### Public Surface Hygiene

- `scan:assets` agora bloqueia referências públicas a namespaces, paths e nomes de origem legada
- criado `docs/CONTENT-MIGRATION-AUDIT.md` como trilha interna de incorporação, sem exposição nas superfícies instaladas

## [1.6.0] — 2026-04-23

### Product Reconciliation

- a árvore canónica `oxe/` foi restaurada como source of truth da release, incluindo `oxe/workflows/`, `oxe/workflows/references/`, `oxe/templates/` e `commands/oxe/` como superfície derivada sincronizada
- `workflow-runtime-contracts.json` voltou a ser contrato obrigatório da release; `sync-runtime-metadata` agora falha fechado quando a fonte canónica ou o registry semântico estão ausentes/inválidos
- `doctor --release` passou a bloquear explicitamente por topologia canónica ausente, contrato semântico inválido e drift entre workflows e wrappers

### Package-vs-Workspace Health

- `status`, `status --full`, dashboard e SDK agora distinguem `workspaceMode: product_package` de `workspaceMode: oxe_project`
- no repositório do pacote, o próximo passo deixa de cair em `plan/replan` por ruído de manutenção e passa a apontar para `doctor --release --write-manifest`
- `status --json` passou a expor `workspaceMode` e `releaseReadiness` como contrato estável da linha `1.6.0`

### Multi-runtime Edge Hardening

- a smoke matrix de release passou a validar a instalação do Codex de forma completa: prompts em `.codex/prompts/` e skills em `.agents/skills/oxe/`
- documentação de instalação foi ajustada para separar `--local` (layout do repo) de `--ide-local` (escopo da integração), eliminando a ambiguidade operacional em runtimes como Codex

### Validation

- `node --test tests/oxe-project-health.test.cjs`
- `node --test tests/oxe-cli-edge.test.cjs`
- `npm test`
- `npm run scan:assets`
- `npm run release:doctor`

## [1.5.1] — 2026-04-22

### Rational Execution Readiness

- `/oxe-plan` passou a exigir e propagar artefatos racionais de execução: `IMPLEMENTATION-PACK`, `REFERENCE-ANCHORS` e `FIXTURE-PACK`
- `/oxe-execute` agora é `pack-first` e bloqueia mutação quando confiança `<= 90%`, quando os packs estão incompletos ou quando há `critical_gap` aberto
- `doctor`, `status --json`, dashboard e SDK passaram a expor `implementationPackReady`, `referenceAnchorsReady`, `fixturePackReady`, `executionRationalityReady` e `criticalExecutionGaps`

### Session Compatibility

- o health report agora faz fallback explícito entre artefatos session-scoped e artefatos ainda materializados na raiz `.oxe/`, evitando falso negativo de readiness em workspaces legados
- o gate racional foi limitado ao estágio pré-execução; depois de `executing`/`verify_complete`, os packs continuam diagnósticos, mas não reescrevem o próximo passo do ciclo

### Publication Alignment

- versão alinhada para `1.5.1` em pacote raiz, runtime package, extensão VS Code, README e lockfile
- matriz pública de smoke runtime atualizada para refletir a release `1.5.1`

### Validation

- `npm test`
- `npm run scan:assets`
- `npm run release:manifest`
- `npm run build:vscode-ext`

## [1.5.0] — 2026-04-21

### Release Readiness 5/5

- `doctor --release --write-manifest` virou gate formal de publicação, com verificação bloqueante de versões, topo do `CHANGELOG`, runtime compilado, wrapper sync e relatórios obrigatórios
- a release agora persiste `release-manifest.json`, `runtime-smoke-report.json`, `recovery-fixture-report.json` e `multi-agent-soak-report.json` em `.oxe/release/`
- `npm test` passou a incluir smoke matrix multi-runtime, fixtures reproduzíveis de recovery/incidente e soak multi-agent

### Operational Proof

- nova smoke matrix obrigatória para Cursor, Copilot VS Code, Claude Code, Codex, OpenCode, Gemini, Windsurf e Antigravity, cobrindo install, entrypoint `oxe`, resolução de workflow e uninstall granular
- novo corpus de incidentes em `tests/fixtures/runtime-incidents/` para provar `runtime replay` e `runtime recover` fora do caminho feliz
- multi-agent passou a gerar e auditar `multi-agent-summary.json`, incluindo timeouts e reassignments

### Publication Contract

- versão alinhada para `1.5.0` em pacote raiz, runtime package, extensão VS Code, README e lockfile
- README, AGENTS e SDK docs atualizados para refletir o gate de release, os relatórios obrigatórios e o contrato estável desta publicação

### Validation

- `npm test`
- `npm run scan:assets`
- `npm run release:doctor`

## [1.4.0] — 2026-04-20

### Runtime Publication Stabilization

- `execute` e `verify` passaram a documentar e propagar o contrato `runtime-first`, com fallback legado explícito quando o runtime enterprise não estiver disponível
- `runtime gates` ganhou superfície operacional estável com `list`, `show`, `resolve`, filtros (`--run`, `--status`, `--scope`, `--task`) e `--json`
- `status --json` e `runtime status --json` consolidam `runtimeMode`, `fallbackMode`, `gateQueue`, `policyCoverage`, `promotionReadiness`, `recoveryState`, `multiAgent` e `providerCatalog`
- dashboard web passou a expor cards operacionais para gates, recovery, promotion e multi-agent, incluindo resolução de gates pela UI
- replay/recovery ficaram orientados a incidente com saída estruturada, reconciliação de run state e summaries derivados
- `multi-agent` foi endurecido como GA apenas sobre workspaces isolados reais; modos `parallel`, `competitive` e `cooperative` falham explicitamente em `inplace`
- SDK ampliado com `GateQueueSnapshot`, `replayRuntimeState`, `readRuntimeMultiAgentStatus` e alias `multiAgentStatus`

### Release Preparation

- alinhamento de versão para `1.4.0` em `package.json`, `package-lock.json`, `packages/runtime/package.json`, `vscode-extension/package.json`, banner e README
- alinhamento de licença da extensão VS Code com o pacote principal e inclusão de `vscode-extension/LICENSE` para empacotamento limpo do VSIX
- licença do projeto alterada de `GPL-3.0` para `MIT`, com manifests e documentação pública alinhados
- README atualizado para refletir o momento atual do produto, o contrato estável de publicação e a superfície enterprise do CLI/runtime
- `lib/sdk/README.md` e `AGENTS.md` atualizados para refletir os bridges do runtime enterprise e o comportamento `runtime-first`

### Adoção em Times (v1.4.0 final)

- `QUICKSTART.md` — guia de onboarding "primeiros 15 minutos": install, primeiro ciclo (6 comandos), runtime-first, validação dos 5 minutos
- `docs/ROLES.md` — guia por papel: executor, reviewer, operador de gate, mantenedor do pacote; cada papel com o que lê, decide e pode ignorar
- `docs/TEAM-ADOPTION.md` — fluxo branch/PR recomendado, ship local vs. promote remoto, sessões e workstreams, governança mínima
- `docs/WALKTHROUGH.md` — walkthrough completo reproduzível: spec → plan → execute → verify → gate → promotion com outputs esperados
- `docs/INCIDENT-PLAYBOOK.md` — gate stale, run bloqueada, RECOVERY-SUMMARY, dashboard como painel operacional
- `docs/RUNTIME-SMOKE-MATRIX.md` — matriz 8 runtimes × 6 operações com pressupostos e comportamentos por runtime
- `oxe-cc doctor` — health gates para IDEs (Copilot, Cursor, Claude Code), detecção de runtime compilado, readiness gate summary com próximo passo derivado da fase atual
- `oxe-cc status` — IDE readiness summary inline, gates pendentes no modo padrão (sem `--full`), diagnóstico de bloqueio explícito (SPEC/PLAN/VERIFY ausentes)
- `runtime gates list` — ícones visuais `⏳ pending` / `⚠ stale (>Nh)` / `✓ resolved`, ação sugerida e impacto no ciclo por gate
- `runtime gates resolve` — mensagem de impacto pós-resolução: "Run pode avançar" ou "N gates restantes"
- `.github/workflows/release.yml` — pipeline de publicação: validate → publish-npm (com provenance) → build-vsix → create-release com extração automática do CHANGELOG
- `.github/workflows/ci.yml` — novos jobs `doctor` (gate de qualidade operacional) e `wrapper-audit` (sync entre wrappers e contrato canônico)
- `README.md` — seção `## Para times` com links para todos os novos docs; link `→ Guia por papel` na seção "Momento atual do produto"

### Validation

- suíte root + runtime continua verde
- scanner de assets/markdown continua íntegro

---

## [1.3.0] — 2026-04-20

### Reasoning Contracts & Semântica Multi-Runtime

- Contratos de raciocínio v2.0.0 (`oxe_contract_version: 2.0.0`) em todos os workflows e wrappers de runtime
- Novos campos de metadata: `oxe_reasoning_mode`, `oxe_question_policy`, `oxe_output_contract`, `oxe_tool_profile`, `oxe_confidence_policy`, `oxe_context_tier`
- `oxe_semantics_hash` (SHA-256 16 chars) para detecção de drift semântico entre IDEs
- Módulo `bin/lib/oxe-runtime-semantics.cjs` gerencia o contrato canônico: `buildReasoningContractBlock()`, `buildContextTiers()`, `auditRuntimeTargets()`, `computeSemanticsHash()`
- `auditRuntimeTargets()` varre Copilot prompts, commands e Cursor commands e reporta divergências entre wrappers e o contrato canônico
- Prompts e commands sincronizados para todos os runtimes: Cursor, GitHub Copilot, Claude Code, OpenCode, Codex, Gemini CLI, Windsurf, Antigravity

### Novos Módulos bin/lib

- **`oxe-dashboard.cjs`** — servidor HTTP local (porta 9000), `loadDashboardContext()`, API REST com `/api/health/status`, `/api/plan/info`, `/api/runtime/gates/{id}/status`, `/api/runtime/gates/resolve`; suporte a PLAN-REVIEW.md com comentários e status de aprovação
- **`oxe-runtime-semantics.cjs`** — gestão de metadados de workflow e contratos de raciocínio: `getWorkflowContract()`, `getAllWorkflowContracts()`, `validateWorkflowContractsRegistry()`, `buildContextPackPaths()`, `buildReasoningContractBlock()`, `splitFrontmatter()`, `parseFrontmatterMap()`
- **`oxe-operational.cjs`** expandido — monitoramento de agents, gates, evidências e estado de run com maior granularidade
- **`oxe-project-health.cjs`** expandido — métricas de saúde: test scores, coverage, violations, integração Copilot

### Comandos e Superfície

- **`oxe-ship`** — cria commit local guiado por `SPEC.md`, `PLAN.md` e `VERIFY.md`; disponível em todos os runtimes suportados
- **`oxe-skill`** — gestão e composição de skills com roles `@executor` e `@researcher`
- Contrato de raciocínio declarado em todos os workflows: `discovery`, `planning`, `execution`, `review`, `status`
- Regra pack-first em todos os wrappers: lê `.oxe/context/packs/<slug>.md` antes de cair para leitura direta

### Testes e Cobertura

- Novos testes unitários para `oxe-runtime-semantics.cjs`: 31 testes cobrindo todas as 19 funções exportadas
- Novos testes para `oxe-plugins.cjs`: 28 testes para `loadPlugins`, `runHook`, `validatePlugins`, `initPluginsDir`, `resolvePluginSources`
- Novos testes para `oxe-security.cjs`: `checkPathSafety`, `scanFileForSecrets`, `scanDirForSecretFiles`, `validatePlanPaths`
- Cobertura de linhas: **80.28% → 82.28%** (superando threshold de 82%)
- Total: **383 testes** passando (root + runtime)

---

## [1.2.1] — 2026-04-18

### Branding, Semântica e Empacotamento

- remove referências remanescentes ao framework legado dos workflows e do diagnóstico de integração Copilot
- alinha `package.json`, `package-lock.json`, banner CLI e README para `1.2.1`
- corrige deriva semântica do workflow `ship`, registrando-o no contrato canônico multi-runtime
- adiciona prompt files de `ship` para Copilot/Cursor
- remove o comando `auto` da superfície pública do OXE
- remove o comando `intel` da superfície pública do OXE
- reposiciona `ship` para fechar o ciclo com commit local guiado por `SPEC.md`, `PLAN.md` e `VERIFY.md`

---

## [1.2.0] — 2026-04-18

### Runtime Hardening & Robustez (Fases 1–9)

**Fase 1 — Runtime Hardening**

- `RunJournal` persistido em `.oxe/runs/{runId}/journal.json`: gravado a cada onda, atualizado no pause/cancel
- `Scheduler.pause()` agora grava journal e retorna `status: 'paused'` em vez de apenas setar flag in-memory
- `Scheduler.recover(runId, ctx, graph)` — retoma run pausado pelo journal; pula nós já completados
- `Scheduler.getJournal()` e `Scheduler.loadJournal(projectRoot, runId)` para inspeção
- `RunState` expandido: `retryCounts`, `policyDecisions`, `pendingGates`, `resolvedGates`, `verificationStatus`, `evidenceRefs`, `toolFailures`
- Reducer: handlers para `RetryScheduled`, `PolicyEvaluated`, `GateRequested`, `GateResolved`, `VerificationStarted`, `VerificationCompleted`, `ToolFailed`, `EvidenceCollected`
- Helpers: `getRetryCount`, `getPolicyDecision`, `getVerificationStatus`, `getEvidenceRefs`, `getToolFailures`

**Fase 2 — Policy, Side Effects e Security**

- `SideEffectClass` enum: `read_fs|write_fs|spawn_process|network_call|git_mutation|db_change|secret_access|infra_operation`
- `AutonomyTier` type: `L0|L1|L2|L3` — tier controla quais side effects são permitidos automaticamente
- `NodePolicyConfig` com `mutation_budget` e `autonomy_tier`
- `EnvironmentGuardrail` com `protected_paths`, `protected_branches`, `require_human_gate_on`
- Guardrails default: paths `.env`, `package.json`, `.oxe/config.json`; gate automático para `infra_operation`, `db_change`, `secret_access`
- `PolicyEngine.withGuardrail(g)` para customizar guardrails por projeto
- `side_effect_class` e `autonomy_tier` em `PolicyWhenClause` para regras direcionadas

**Fase 3 — Verify Operational**

- `VerificationManifest` formal: persistido em `.oxe/runs/{runId}/verification-manifest.json`
- `VerificationProfile`: `quick|standard|critical` — controla quais `FailureClass` geram riscos residuais
- `FailureClass` taxonomy: `deterministic|flaky|timeout|env_setup|policy_failure|evidence_missing`
- `classifyFailure(result)` — classifica automaticamente cada `CheckResult`
- `buildManifest(runId, results, options)` — compila manifest por work item, onda ou run
- `ResidualRiskLedger` persistido em `.oxe/runs/{runId}/residual-risks.json`
- `buildRiskLedger(runId, manifest)` — gera ledger de riscos residuais a partir do manifest

**Fase 4 — Delivery Native**

- `MergeGateEvaluator.evaluate(runResult, manifest, ledger)` — avalia se run está pronto para merge
- Bloqueios: tarefas failed/blocked, verificação falha, riscos `high`/`critical`
- `PromotionPipeline.promote(runResult, manifest, ledger, opts)` — cria PR draft via `gh`, persiste `RunPRLink`
- `PromotionPipeline.buildPRBody(...)` — corpo do PR com resumo, verificação e riscos residuais
- `RunPRLink` persistido em `.oxe/runs/{runId}/pr-link.json`

**Fase 5 — Context Engineering Avançado**

- `ContextPackStore`: `savePack`, `loadPack`, `markStale`, `isStale`, `listPackMeta` — packs persistidos em `.oxe/runs/{runId}/context-pack-{workItemId}.json`
- `ContextPackMeta` com `estimated_tokens`, `stale`, `stale_reason`
- `diffPacks(before, after)` — detecta added/removed/score_changed entre versões de pack
- Índice global por run em `context-packs.index.json`

**Fase 6 — Decision Engine / Seniority**

- `DecisionEngine.evaluate(input)` — avalia policy, gate, retry budget, risk, lesson match e retorna `DecisionRecord` com `type`, `seniority`, `confidence` e `rationale`
- Tipos de decisão: `proceed|retry|escalate_gate|skip|abort|promote_lesson`
- `SeniorityLevel`: `junior|standard|senior|expert` derivado da confidence
- `appendDecision`, `loadDecisionLog`, `queryDecisions` — log persistido em `.oxe/runs/{runId}/decisions.json`

**Fase 7 — Multi-Agent Robusto**

- `AgentRegistry` com heartbeat tracking por agente
- `registry.beat(id, currentTask)` — atualiza last_seen e status
- `registry.isAlive(id)` — detecta timeout configurável por instância
- `registry.timedOut()` / `registry.liveAgents()` — filtragem por liveness
- `registry.failover(fallbackAgentId)` — reassigna tasks de agentes expirados para fallback
- `registry.setStatus(id, status)` — transições manuais de estado

**Fase 8 — ABI Estável de Plugins**

- `PluginManifest` com `abi_version`, `capabilities`, declared providers
- `extractManifest(plugin)` — extrai manifest de qualquer `OxePlugin`
- `validatePlugin(plugin)` — retorna `{ valid, errors, warnings }` com checagem de nome, semver, providers
- `isAbiCompatible(version)` — garante compatibilidade de major version
- `sandboxInvoke(fn, timeoutMs)` — execução com timeout e isolamento de erro para plugins

**Fase 9 — Enterprise Operations**

- `AuditTrail` — registro imutável NDJSON em `.oxe/AUDIT-TRAIL.ndjson`
- 14 tipos de ação auditáveis: `run_started`, `secret_accessed`, `infra_mutation`, `merge_approved`, etc.
- Severity automática por ação (`info|warn|critical`)
- `AuditTrail.query(filter)` — filtra por action/severity/runId/since
- `RunQuota` — `createQuota`, `consumeQuota`, `checkQuota` para limitar work_items, mutations e retries por run

### Testes

- Runtime: **266 testes** (↑ de 145 pré-robustez)
- Root: 321 testes (sem regressões)
- Total: **587 testes** passando

---

## [1.1.0] — 2026-04-18

### Mudança de superfície (simplificação estratégica de produto)

**Trilha principal reduzida a 6 comandos**

O OXE agora se comporta como um framework guiado por etapas. A superfície pública foi reorganizada em três níveis:

**Trilha principal (6 comandos):**
- `/oxe` — entrada universal (absorve ask, next, route, help)
- `/oxe-quick` — modo nano sem cerimônia
- `/oxe-spec` — spec com flags: `--refresh`, `--full`, `--research`, `--ui`
- `/oxe-plan` — planejamento test-first
- `/oxe-execute` — implementação com flags: `--note`, `--debug`, `--deep-diagnosis`, `--checkpoint`, `--iterative`
- `/oxe-verify` — validação e fechamento com flags: `--gaps`, `--security`, `--ui`, `--pr`, `--diff`, `--skip-retro`

**Trilha avançada:** `/oxe-session` (absorve project, milestone, workstream), `/oxe-dashboard`

**Administrativa:** `/oxe-capabilities`, `/oxe-skill`, `oxe-cc azure`

### Depreciado (v1.1.0)

Os seguintes comandos foram incorporados por estágios principais e continuam funcionando com aviso de migração:

| Comando | Novo destino |
|---------|-------------|
| `/oxe-ask` | `/oxe "pergunta"` |
| `/oxe-scan` | `/oxe-spec --refresh` |
| `/oxe-research` | `/oxe-spec --research` |
| `/oxe-ui-spec` | `/oxe-spec --ui` |
| `/oxe-obs` | `/oxe-execute --note` |
| `/oxe-debug` | `/oxe-execute --debug` |
| `/oxe-forensics` | `/oxe-execute --deep-diagnosis` |
| `/oxe-checkpoint` | `/oxe-execute --checkpoint` |
| `/oxe-loop` | `/oxe-execute --iterative` |
| `/oxe-validate-gaps` | `/oxe-verify --gaps` |
| `/oxe-security` | `/oxe-verify --security` |
| `/oxe-ui-review` | `/oxe-verify --ui` |
| `/oxe-review-pr` | `/oxe-verify --pr` |
| `/oxe-retro` | `/oxe-verify` (retro automática) |
| `/oxe-project` | `/oxe-session milestone\|workstream` |
| `/oxe-compact` | `/oxe-spec --refresh` |
| `/oxe-next` | `/oxe` (sem argumento) |
| `/oxe-route` | `/oxe "intenção"` |
| `/oxe-milestone` | `/oxe-session milestone` |
| `/oxe-workstream` | `/oxe-session workstream` |

### Novos comportamentos

- **Retro automática:** `/oxe-verify` executa automaticamente retrospectiva ao fechar (`--skip-retro` para desativar)
- **Pergunta situacional inline:** `/oxe "pergunta"` substitui `/oxe-ask`
- `/oxe-session` agora suporta `milestone` e `workstream` como subcomandos

---

## [0.8.0] — 2026-04-14

### Adicionado

**Session forking + revert**
- `session fork [nome]` — bifurca a sessão ativa, copiando todos os artefatos para uma nova sessão; rastreia `forked_from` na SESSION.md
- `session revert <checkpoint-slug>` — restaura STATE.md ao snapshot de um checkpoint, sem apagar artefatos atuais

**Skill system**
- `/oxe-skill` — workflow para descobrir, invocar e gerenciar skills (unificação de personas e capabilities)
- `@<skill-id>` no chat resolve persona OU capability OU composite como ponto de entrada único
- Template `SKILL.template.md` para criação de skills de projeto em `.oxe/skills/`
- Resolução em 3 camadas: project → capabilities → global (personas do pacote)

**Sistema de permissões com wildcard**
- `permissions[]` em `.oxe/config.json` — regras glob+ação que controlam acesso a arquivos durante execute e apply
- Ações: `allow`, `deny`, `ask` — avaliação first-match wins
- Scopes: `execute`, `apply`, `all`
- Gate automático no workflow execute antes de cada onda

**Config hierárquico (system → user → project)**
- `loadOxeConfigMerged()` agora lê 3 níveis: system (`OXE_SYSTEM_CONFIG` ou path OS-default) < user (`~/.oxe/config.json`) < project (`.oxe/config.json`)
- `status --full` exibe fontes de cada nível de configuração
- Campo `sources` no retorno do SDK

**Event sourcing com replay**
- `replayEvents()` no SDK — reconstrói timeline de `OXE-EVENTS.ndjson` com deltas, filtros por run/wave/event
- `oxe-cc runtime replay [--run <id>] [--from <event-id>] [--wave <n>] [--write]` — visualização de timeline no terminal ou `REPLAY-SESSION.md` em disco
- Integração com `/oxe-forensics` — replay como ferramenta de investigação

**Plugin system com carregamento remoto**
- `plugins[]` em `config.json` aceita `{ source: "npm:<pkg>" }` e `{ source: "path:./file.cjs" }`
- `oxe-cc plugins list` — lista plugins carregados (local + externos)
- `oxe-cc plugins install npm:<pkg>` — instala plugin npm em `.oxe/plugins/_npm/`
- `resolvePluginSources()` e `installNpmPlugin()` expostos no SDK

### Tipos TypeScript
- `OxePermissionRule`, `PermissionCheckResult`, `ReplayReport`, `PluginSource` adicionados
- `security.checkFilePermission`, `security.checkPermissions`, `security.globToRegex` declarados
- `operational.replayEvents` declarado
- `plugins.resolvePluginSources`, `plugins.installNpmPlugin` declarados
- `health.loadOxeConfigMerged` retorna `sources: { system, user, project }`

---

## [0.7.0] — 2026-04-13

### Adicionado

**Provider Azure nativo (`oxe-cc azure`)**
- `azure status` — estado compacto read-only: CLI, login, subscription, inventário, pendências, alerta VPN
- `azure operations list` — histórico colorido de operações (planned/applied/pending)
- `azure find --type <serviço>` — filtro por família de serviço (servicebus, eventgrid, sql)
- `azure find --filter-rg <rg>` — filtro por resource group
- `azure sync --diff` — mostra recursos adicionados/removidos em relação ao snapshot anterior
- `azure apply --dry-run` — pré-visualiza comando `az` sem executar nem criar artefatos
- `azure auth login --tenant <id>` — suporte a Entra ID corporativo; passa `--tenant` ao `az login`
- `azure apply --vpn-confirmed` — confirma conexão VPN quando `vpn_required: true` está configurado

**SDK**
- `azure.diffInventory(previousItems, currentItems)` — compara snapshots de inventário (adicionados/removidos/unchanged)
- `azure.statusAzure(projectRoot, config?, options?)` — status compacto sem writes

**Workflows (guardrails)**
- `scan.md`: detecção Azure é informativa — não altera fluxo canônico OXE nem aciona steps Azure automaticamente
- `plan.md`: pré-check Azure só ativa quando Azure é mencionado **explicitamente** na SPEC ou `.oxe/cloud/azure/` existe
- `discuss.md`: perguntas Azure só ativam quando SPEC menciona Azure explicitamente — SQL genérico (PostgreSQL, MySQL, on-prem) não aciona o bloco

### Corrigido
- `loginAzure()` com `inherit: true` não passava mais `inherit` para `getAzureContext`, evitando crash ao tentar ler `account.id` de stdout null

### Tipos TypeScript
- `azure.searchAzureInventory` inclui parâmetro opcional `filters?: { type?, resourceGroup? }`
- `azure.diffInventory` declarado
- `azure.statusAzure` declarado

---

## [0.6.3] — 2026-04-04

### Corrigido
- `security_in_verify` agora é reconhecido como chave válida em `.oxe/config.json` (não mais rejeitado pelo doctor como "unknown key")
- `plan-agents.schema.json`: enum atualizado de `[1, 2]` para `[2, 3]`; campos `persona` e `model_hint` adicionados ao schema dos agentes

### Adicionado
- **`/oxe-retro` sugerido automaticamente** pelo `oxe-cc status` quando `phase: verify_complete` e `.oxe/LESSONS.md` ainda não existe
- **`health.parseLastRetroDate(stateText)`** — parseia campo `last_retro: YYYY-MM-DD` do STATE.md
- **`health.isStaleLessons(retroDate, maxDays)`** — detecta se LESSONS.md está desatualizado (par de `isStaleScan`)
- **`health.planAgentsWarnings(target)`** — avisa sobre schema 1 (legado) e `model_hint` inválido em `plan-agents.json`
- **`parseState()`** retorna novo campo `lastRetroDate: string | null`
- `OxeHealthReport` inclui `retroDate: Date | null`
- `config.template.json` inclui `security_in_verify: false` por padrão
- `plan-agents.template.json` inclui campo `persona` no agente-exemplo
- Melhorias de workflow: `obs.md` (tabela de classificação de impacto), `verify.md` (success_criteria camadas 5+6), `next.md` (flag de promoção QUICK→spec), `quick.md` (incorporação de OBSERVATIONS), `plan.md` (nota de replan + plan-agents sync)
- `AGENTS.md` atualizado para v0.6.x

### Tipos TypeScript
- `ParsedState` inclui `lastRetroDate: string | null`
- `OxeHealthReport` inclui `retroDate: Date | null`
- `health.*` expõe `parseLastRetroDate`, `isStaleLessons`, `planAgentsWarnings`

---

## [0.6.2] — 2026-04-04

### Adicionado
- **`/oxe-retro`** — workflow de retrospectiva de ciclo; sintetiza 3–5 lições prescritivas em `.oxe/LESSONS.md`
- `oxe/templates/LESSONS.template.md`
- Correções de consistência de schema (plan-agent.md, verify.md): referências atualizadas para schema v3

### Alterado
- README: tabela "Como cada comando fica mais inteligente" expandida com loop, security, research thinking_depth, model_hint
- Cadeia de help (`oxe.md`) atualizada para incluir `/oxe-retro` após verify

---

## [0.6.1] — 2026-04-04

### Adicionado
- **`/oxe-security`** — auditoria OWASP Top 10 filtrada pelo stack; produz `.oxe/SECURITY.md` com achados P0/P1/P2
- **`/oxe-loop`** — execução iterativa de onda com retries automáticos e diagnóstico inline
- **Model hints** em `plan-agents.json` schema v3: campo `model_hint` (`fast | balanced | powerful`) por agente
- **Thinking depth** em `/oxe-research`: classificação `surface | standard | deep` com raciocínio estendido para `deep`
- Integração automática de security no verify via `security_in_verify: true` (Camada 6)
- `oxe/templates/SECURITY.template.md`

---

## [0.6.0] — 2026-04-04

### Adicionado
- Workflow `/oxe-project` unificando `milestone`, `workstream`, `checkpoint`
- `/oxe-obs` com propagação automática para R-IDs e Tns afetados
- Auto-reflexão semântica em `/oxe-spec` (Fase 4b): detecta contradições e escopo creep antes da aprovação
- Modo de execução A/B/C em `/oxe-execute` (Completo / Por onda / Por tarefa)
- Debug inline automático em falhas de execute
- 4 profiles de execução: `balanced`, `strict`, `fast`, `legacy`
- Sistema de personas para agentes (`oxe/personas/`)
- Plugin lifecycle (`.oxe/plugins/*.cjs`)
- `scale_adaptive`: scan sugere profile pelo tamanho do projeto

---

## [0.5.0] — anterior

Versões anteriores não documentadas neste arquivo.
