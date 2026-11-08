# Backlog do oxe-build: validação pela OXESpace 1.5.0

Este backlog continua o de `docs/oxevoice/BACKLOG.md`: a numeração segue a partir do OXB-031. A fonte é a implementação de ponta a ponta da OXESpace 1.5.0 com o oxe-cc 1.21. São 8 fases, 60 tarefas e um time de agentes (TECH LEAD, BACKEND, FRONTEND, MOBILE, DESIGN, HML e SRE) trabalhando num repositório grande, com trem de merge e CI pesada.

Registro mantido pelo TECH LEAD do oxespace. Cada entrada traz evidência, impacto e uma proposta que vai além do conserto pontual. Os status possíveis são `aberto`, `em andamento`, `resolvido (<commit>)` e `proposta`.

O objetivo é duplo: evoluir o OXESpace e o oxe-build ao mesmo tempo.

---

## OXB-031: a versão 1.21 não está no npm, e cada time instala de um jeito

- **Status:** em andamento. A publicação da 1.21.2 espera o lançamento do OXESpace 1.5.0, por decisão do usuário. Já está feito (1.21.2):
  - O `doctor` mostra qual oxe-cc gerou o `.oxe/` e qual está rodando. Ele avisa quando elas diferem e diz qual usar (`npx oxe-cc@<versão do projeto>` ou `oxe-cc update`). Um `.oxe/` escrito por uma versão MAIS NOVA que a em execução (o caso do global 1.12) é stale.
  - A versão fica em `.oxe/oxe-version.json`, gravado por toda escrita do runtime, e no README gerado pelo init/update. Os comandos de leitura não gravam nada.
  - Teste: `tests/oxe-1212-oxe-dir-info.test.cjs`.
- **Evidência (04/11):**
  - `npm view oxe-cc version` = 1.16.0;
  - global instalado = 1.12.0;
  - o 1.21.0 só existe no repositório local.
  - A instalação no oxespace foi feita com `node <oxe-build>/bin/oxe-cc.js install --oxe-only --local --dir <worktree>`.
- **Impacto:** cada agente do time precisa saber o caminho local. O `npx oxe-cc` de qualquer sessão roda uma versão velha sem programa por fases, e o doctor não avisa.
- **Proposta:** publicar a 1.21 (ou um canal `next`), e o `doctor` comparar a versão que gerou o `.oxe/` com a que está rodando, avisando no mismatch.

## OXB-032: o ROADMAP e a SPEC vivem em `.oxe/`, que o repositório não versiona

- **Status:** resolvido (1.21.2).
  - `spec_ref` e `roadmap_ref` no `.oxe/config.json` (caminhos relativos à raiz, ex.: `docs/roadmap-1.5/oxe/SPEC.md`) fazem o runtime ler **e emendar** esses arquivos em vez de `.oxe/SPEC.md` e `.oxe/ROADMAP.md`. Isso vale para compile, verify, lint, `program init`, `spec amend|add`, `program phase add|edit` e `status`. Uma SPEC própria da sessão continua tendo precedência.
  - O PR revisado passa a ser o que o runtime executa. Nenhuma cópia é criada em `.oxe/`.
  - O `doctor` avisa quando um ref configurado não existe (o runtime volta para `.oxe/`) e quando uma cópia em `.oxe/` diverge do ref, comparando o conteúdo por hash e ignorando CRLF.
  - O `program export` para a pasta do ref não copia um arquivo sobre ele mesmo.
  - Teste: `tests/oxe-1212-artifact-refs.test.cjs`.
- **Evidência:** o oxespace ignora `.oxe/` no `.gitignore`, como o próprio template sugere. O `program init` lê `.oxe/ROADMAP.md`. Para o time revisar o plano num PR, foi preciso copiar a SPEC e o ROADMAP para `docs/roadmap-1.5/oxe/` à mão, e cada edição exige recopiar (aconteceu 3 vezes no mesmo dia).
- **Impacto:** cópias divergem, e o PR revisado pode não ser o que o runtime executa.
- **Proposta:** um `roadmap_ref`/`spec_ref` no `config.json` apontando para caminhos versionados (ex.: `docs/roadmap-1.5/oxe/ROADMAP.md`), e o runtime lê de lá. Se for preciso manter a cópia em `.oxe/`, o `doctor` acusa a divergência por hash.

## OXB-033: as fases são estritamente seriais; um time com frentes paralelas fica parado

- **Status:** resolvido (1.21.2).
  - `**Depende de:** F1, F3` numa seção do ROADMAP vira `depends_on` da fase. O texto entre parênteses é comentário. Sem a linha, vale o padrão serial: todas as fases anteriores.
  - O `program init` recusa ciclo, auto-dependência e fase inexistente.
  - `program start Fn` exige fechadas só as dependências da fase. Com F1 fechada, a F3 começa com a F2 aberta, e a mensagem diz de quem a fase depende.
  - Um `.oxe/` continua tendo uma fase ativa: fases independentes rodam em paralelo em worktrees separadas, cada uma com o seu `.oxe/`.
  - `oxe-cc runtime program adopt --from <worktree> [--phase Fn]` traz para cá a fase fechada lá: status, dados do close, regressão congelada e interfaces. Uma fase ativa aqui nunca é sobrescrita, e um ROADMAP divergente entre as worktrees é recusado. Fica um `program_edit` (`phase_adopt`).
  - A regressão de uma fase passa a incluir **toda** fase fechada além dela, já que com DAG uma fase posterior pode fechar antes. No serial, nada muda.
  - `program phase edit Fn --depends-on F1,F3` (ou `none`, ou `roadmap` para o padrão serial) muda PROGRAM.json e ROADMAP juntos, só em fase não iniciada e com checagem de ciclo. O `program phase add` renumera também as dependências.
  - O `program status` mostra `← F1` (ou `independente`) e `(adotada de …)`.
  - Teste: `tests/oxe-1212-phase-dag.test.cjs`.
- **Evidência:**
  - na 1.5.0, a F3 (worktrees, backend) não depende da F2 (Settings, frontend);
  - a F7 (modos) quase não depende de F4–F6.
  - Mesmo assim, o `program-model` só deixa começar uma fase depois de todas as anteriores fecharem.
- **Impacto:** com 5 papéis, a execução fica limitada ao ritmo da fase mais lenta, o que contraria a regra do time de "ninguém parado quando uma linha bloqueia".
- **Proposta:** dependência entre fases como DAG (`depends_on` por fase no ROADMAP), com fases independentes rodando em paralelo em worktrees separadas. O `program close` continua exigindo os gates de cada fase.

## OXB-034: editar o ROADMAP depois do `program start` exige `init --force`

- **Status:** resolvido (1.21.2) pelos itens OXB-058, OXB-075 e OXB-076, sem `init --force`.
  - `oxe-cc spec amend|add`, `oxe-cc program phase add|edit` e `oxe-cc program criterion move` emendam SPEC, ROADMAP e PROGRAM.json juntos e preservam o estado das fases. Fase iniciada não ganha critério novo, e fase fechada é recusada (a mudança vira CR).
  - Cada emenda fica registrada em `changes.ndjson` (`spec_gap` ou `program_edit`, com o antes e o depois).
- **Evidência:** a revisão do coordenador acrescentou A40 e A41 à F8 com a F1 já iniciada. O caminho disponível foi `runtime program init --force`.
- **Impacto:** não está claro se o `--force` preserva o estado das fases já iniciadas ou fechadas. Se não preservar, uma emenda de escopo apaga o progresso.
- **Proposta:** um `runtime program amend` que aplica a emenda ao ROADMAP sem perder o estado. Nas fases fechadas, a emenda vira um CR `spec_gap` versionado em vez de sobrescrever.

## OXB-035: tarefas que o time já faz fora do executor não têm lugar no plano

- **Status:** resolvido (1.21.2) pelos itens OXB-047, OXB-061 e OXB-064.
  - `kind: external_delivery` (ou `verify_only`) com `blocked_by: ["owner/repo#n"]`: a tarefa não roda o executor, só o verify. Ela é destravada quando o PR é mergeado e conta como feita por fora.
  - Ela nunca é reaberta por CR, e o execute termina `completed_with_external_pending` enquanto o PR está aberto.
  - Na F1 da 1.5.0, as tarefas entregues por outros agentes usaram esse caminho.
- **Evidência:** na F1, três tarefas são PRs que outros agentes já tinham em voo (pareamento, tela de falha do banco, S7.1). Outra (os tokens C4, PR #604) foi feita pelo FRONTEND antes de o PLAN.json existir. O `blocked_by` cobre "espere um PR externo", mas não "esta tarefa do plano foi entregue por outro caminho; verifique e marque como feita".
- **Impacto:** o plano ou duplica o trabalho ou mente sobre o que o executor fez.
- **Proposta:** `kind: external_delivery` com `pr: <repo#n>`. O verify roda os testes congelados contra a main depois do merge, e a tarefa fica `done` com `completed_by: external`, contando no scorecard à parte.

## OXB-036: decisões de orçamento mudam no meio do programa

- **Status:** resolvido (1.21.2).
  - `oxe-cc runtime program budget --mode cap|track_only [--budget-usd N] [--budget-turns N] --by <papel> --reason "…"` grava a política em `PROGRAM.json` (`budget_policy`) com o histórico (quem, o quê, quando, por quê) e um `program_edit` em `changes.ndjson`. Sem `--mode`, mostra a política e as últimas decisões.
  - **`cap`:** o teto vale para toda run de toda fase, acima do teto anterior do ledger e do `budget` do PLAN.json, sem editar cada plano.
  - **`track_only`:** sem teto, e o teto anterior da mesma run cai na hora. O ledger continua registrando o gasto (para o scorecard), e as proteções contra laço (régua de suspeita, turnos máximos por tentativa) continuam.
  - Uma flag explícita do execute (`--budget-usd`/`--budget-turns`) sempre vale.
  - Teste: `tests/oxe-1212-budget-policy.test.cjs`.
- **Evidência:**
  - o usuário aprovou um teto de US$ 275 por fases e, horas depois, removeu o teto ("o valor final é o produto funcional").
  - Hoje o orçamento vive em flags do `execute` ou no `budget` de cada PLAN.json.
- **Impacto:** é preciso editar cada PLAN.json, e o ledger não registra quem mudou a política nem quando.
- **Proposta:** `budget_policy` no `PROGRAM.json` (`cap` | `track_only`), com histórico de quem decidiu. No modo `track_only`, o scheduler mantém só a proteção contra laço (régua de suspeita + turnos máximos por tentativa) e o scorecard reporta o gasto.

## OXB-037: o critério A* da SPEC é grosso demais para a UI, e o OXE não tem subcritérios

- **Status:** resolvido (1.21.2).
  - **Subcritérios `A19.3`:** valem na tabela de critérios da SPEC, no ROADMAP, no `acceptance` e nos `acceptance_tests` do PLAN.json, no `--criteria` de CR e sign-off e no `spec add criterion A19.3` (que exige o pai e não conta como buraco na numeração).
    - Um subcritério pertence à fase do pai.
    - Se a SPEC declara subcritérios de A19, A19 só fica coberto quando cada A19.x está coberto, e o lint lista os que faltam (`A* da fase sem tarefa: A19.2`).
    - O verify da fase mantém os subcritérios dos critérios da fase.
  - **Critérios globais `G<n>`:** valem para toda fase (nunca "de outra fase") e para toda tarefa de UI (arquivos .tsx/.jsx/.vue/.svelte/.css/.scss/.html). O lint avisa quando um G* não é coberto por nenhuma tarefa de UI do plano.
  - Fica para depois: techspec por subcritério no dossiê.
  - Teste: `tests/oxe-1212-criteria-ids.test.cjs`.
- **Evidência:** o DESIGN entregou critérios de aceite por tela (`team/plans/1.5.0-ui-acceptance.md`, com G1–G9 globais mais vários ACs observáveis por tela), organizados por onda de backend. A SPEC da 1.5.0 tem 41 A*, cada um cobrindo várias telas. O `idList` do program-model só reconhece `A<n>`, e o lint não tem como ligar um teste congelado a "A19, tela X, estado Y".
- **Impacto:** ou a SPEC cresce para centenas de A*, ou a ligação critério → teste fica implícita, e o OXB-030 (termo do critério que o teste não exercita) volta pela porta da UI.
- **Proposta:** subcritérios `A19.3` na SPEC, aceitos pelo parser, pelo lint (cobertura por subcritério) e pelo dossiê (techspec por subcritério). Junto, critérios globais (`G*`) que valem para toda tarefa de UI da fase, como contraste, teclado e 900 px.

## OXB-038: qualquer `A<n>` em texto vira critério da SPEC (colisão de namespace)

- **Status:** resolvido (1.21.2).
  - Na linha `**Critérios de aceite:**` do ROADMAP, o texto entre parênteses e em código é comentário. Só os ids exatos (`A<n>`, `A<n>.<m>`, `G<n>`) fora dele contam: `A1, A19 (telas do DESIGN: A3, A7)` dá A1 e A19.
  - O `program init` e o `plan lint` (fase ativa) avisam quando um critério de fase não está na tabela da SPEC ("id de outro documento?").
  - O `plan lint` lê os documentos de `inputs:` do front matter da SPEC e avisa quando eles usam os mesmos `A<n>` dos critérios da SPEC, sugerindo renomear lá (ex.: UA1).
  - Teste: `tests/oxe-1212-criteria-ids.test.cjs`.
- **Evidência:** o `idList` do program-model (`\b[A-Z]{1,4}-?\d+[a-z]?\b`, filtrado por `^A`) trata como critério da SPEC qualquer token `A8` no ROADMAP, inclusive em ids de outros documentos. Os ACs de UI do DESIGN usavam `A1–A12` por tela, e precisaram ser renomeados para `UA1…` antes de aparecer em planos e `proves`.
- **Impacto:** um id externo citado no texto de uma fase vira critério fantasma, ou mascara um A* real que faltava.
- **Proposta:** ids da SPEC só valem nos campos estruturados (a linha `**Critérios de aceite:**` e a tabela da SPEC), nunca em prosa. O lint também acusa colisão entre os A* da SPEC e ids de documentos de entrada (`inputs:` da SPEC).

## OXB-039: o `npm ci` da worktree remove em silêncio a dependência nativa, mesmo com Node certo

- **Status:** resolvido (1.21.2). O `doctor --project` e o preflight (logo, o execute e o `plan lint`) fazem três checagens:
  - **presença:** cada entrada do package-lock (v2/v3) precisa estar em `node_modules`, opcionais incluídas. O pacote nativo descartado como "failed optional dependency" vira problema. Ficam de fora opcionais de outro OS/CPU, `dev` com NODE_ENV=production, peer opcionais e checkout sem node_modules;
  - **atualidade:** aviso quando `node_modules/.package-lock.json` é mais velho que o `package-lock.json`;
  - **native_check do projeto:** config `native_check` (ex.: `node scripts/run-native-verification.mjs`) roda com a política de env do runtime; uma falha bloqueia com as últimas linhas. O `npm ci` não é proibido; a instalação é verificada depois. Ele roda no `doctor --project` e uma vez no preflight de cada execute, nunca no `plan lint` (o script do oxespace abre o Electron).
  - Teste: `tests/oxe-1212-deps-present.test.cjs`.
  - O `deps_strategy` por worktree fica para a OXB-050.
- **Evidência (04/11):**
  - Na worktree do plano (`oxespace-150`), com Node 22.22.2 compatível, o `npm ci` rodou `node-gyp rebuild` no `better-sqlite3@13` (`gypfile:false`, com prebuilds).
  - O `node-gyp rebuild` falhou, e o npm marcou o pacote como "failed optional dependency" e o apagou.
  - O `postinstall` (`rebuild:native`) quebrou depois com `Cannot find module 'better-sqlite3'`.
  - O `doctor --project` disse "ambiente compatível".
  - Contorno: copiar o pacote com os prebuilds de outra worktree.
- **Impacto:** cada worktree de tarefa do executor que rodar `npm ci` perde o SQLite. Os testes de banco (`test:electron`) quebram por um motivo de ambiente que parece código, ou somem.
- **Proposta:**
  - o `doctor --project` e o preflight checam se cada dependência do lockfile **está de fato presente** depois da instalação, comparando o lockfile com `node_modules`, inclusive as opcionais;
  - o setup de worktree do executor oferece `deps_strategy: link | copy-from:<path> | ci` (link com junction desfeita no dispose, o que a 1.21 já faz);
  - o executor reaproveita um `node_modules` validado em vez de instalar por tarefa.

## OXB-040: o dry-verify chama de "comando quebrado" um vermelho legítimo quando a tarefa mistura arquivo novo e arquivo existente

- **Status:** resolvido (1.21.2).
  - A classificação passou a ser por arquivo: `missing_target` quando a saída cita um alvo que ainda não existe (ou um diretório-alvo ainda inexistente, com `\` e `\\` normalizados para `/`), e `assertion_red` quando as asserções do runner falham e ALGUM arquivo próprio da tarefa já existe. Antes, exigia todos.
  - A T6 (altera arquivo existente e cria um novo) e as dependentes dela deixaram de virar `broken_command`.
  - Um diretório que já existe mencionado num "not found" não conta.
  - Erros de ferramenta (Unknown option etc.) continuam `broken_command`.
  - No win32, um verify com aspas simples gera aviso, e o `broken_command` diz a causa provável ("troque por aspas duplas").
  - Teste: `tests/oxe-1212-dryrun-classify.test.cjs`.
- **Evidência:** no `plan lint --dry-verify` da F1, 6 de 7 erros eram vermelhos corretos marcados como `broken_command`.
  - **Dois caminhos excludentes no `classifyFailure`:** o caminho `assertion_red` exige `targetsExist` (todos os arquivos da tarefa e das dependências pendentes existem). O caminho `missing_target` exige que a saída mencione um alvo. Uma tarefa que **altera arquivos existentes e cria um teste novo** (T6) não cabe em nenhum dos dois.
  - **Propagação:** o erro passa para as tarefas que dependem dela (T8–T11), via `pendingDependencyFiles`.
  - **Diretório não reconhecido:** `ENOENT scandir src\design\icons` não é reconhecido como alvo ausente, porque só o basename de arquivo é comparado (e com separador `\` no Windows).
  - **Aspas no Windows:** `--jq '.[0].conclusion'` quebrou, porque o runner não passa as aspas simples pelo shell do Windows. Era um erro real do plano, mas a mensagem não diz isso.
- **Impacto:** o planner contorna o classificador, tirando testes próprios do escopo da tarefa ou importando um módulo só para provocar "missing target". Isso distorce o plano para agradar a ferramenta.
- **Proposta:**
  - classificar por arquivo: `assertion_red` quando as asserções falham sobre arquivos existentes, mesmo que outros alvos da tarefa ainda não existam;
  - reconhecer diretórios-alvo (o prefixo comum dos `files`) e normalizar os separadores;
  - avisar sobre aspas simples em comandos quando a plataforma é win32.

## OXB-041: o `plan lint` dá "ok" sem PLAN.md e sem os pacotes racionais, e o execute recusa depois

- **Status:** resolvido (1.21.2), junto com o OXB-044.
  - O `plan lint` roda o mesmo preflight do `runtime execute` (`buildRuntimeExecutePreflight`) em modo seco e lista todos os bloqueios como erro `preflight: …`: autoavaliação, confiança, ambiente do projeto, "PLAN.md ausente" (o execute recusa sem ele) e as lacunas de racionalidade (pack, symbols, VISUAL-INPUTS) sempre que o PLAN.md existe, com pack ou sem. Antes, sem IMPLEMENTATION-PACK, essas lacunas eram aviso.
  - Gates humanos pendentes do run atual viram aviso.
  - "lint ok" agora quer dizer "o execute não recusa". `--no-preflight` (ou config `plan_lint_preflight: false`) volta ao lint só do plano.
  - Teste: `tests/oxe-1212-lint-preflight.test.cjs`, que inclui a paridade: os erros `preflight:` do lint são exatamente os bloqueios do preflight.
- **Evidência:**
  - Com só o `PLAN.json` (mais os testes congelados), o `plan lint` e o `plan lint --dry-verify` deram "✓ ok".
  - O `runtime execute` parou em seguida com "PLAN.md ausente".
  - Ao criar o PLAN.md e o IMPLEMENTATION-PACK, o mesmo `plan lint` passou a acusar 6 erros que já existiam antes: `symbols` ausentes em 5 tarefas e `VISUAL-INPUTS.json` ausente.
- **Impacto:** o "ok" do lint não quer dizer "pronto para executar". O lint é mais brando quando faltam artefatos do que quando eles existem, e isso contraria o OXB-028 ("um validador só").
- **Proposta:**
  - o lint exige os mesmos artefatos que o preflight (PLAN.md ou geração automática a partir do PLAN.json, os pacotes e VISUAL-INPUTS quando a SPEC declarar entradas visuais);
  - ou o runtime gera o PLAN.md como projeção do PLAN.json, como já faz com o STATE.md;
  - os pacotes deveriam poder ser derivados do PLAN.json (paths, checks, símbolos lidos do código) por um `oxe-cc plan pack`, em vez de escritos à mão.

## OXB-042: o executor repassa o ambiente inteiro do terminal aos filhos; só o dry-verify limpa

- **Status:** resolvido (1.21.1). Um scrub só para todos os filhos do runtime (`childProcessEnv`), com `env_scrub`/`env_allow` no config e lista no `doctor --project`.
- **Evidência:**
  - `bin/lib/oxe-verify-dryrun.cjs` tem o `scrubbedEnv`, que remove `OXESPACE_*` e `TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL`.
  - O executor usa o `childProcessEnv`, que só remove `NODE_TEST_CONTEXT`.
  - O terminal do oxespace carrega `OXESPACE_MCP_TOKEN`, `OXESPACE_EXECUTION_TOKEN`, `OXESPACE_AGENT_HOOK_PORT` e outras, do app ao vivo.
  - Os filhos `claude -p` e os comandos de verify herdariam tudo isso: testes falariam com o app ao vivo do usuário, e tokens iriam para processos do executor.
- **Impacto:** segurança (vazamento de token) e falsos resultados, com o teste batendo no app real. Depende de cada time lembrar o `unset`.
- **Proposta:**
  - um `childProcessEnv` único, com o mesmo scrub do dry-verify;
  - `env_scrub` no `config.json` (padrões extras, ex.: `AI_MEMORY_*`) e `env_allow` para o que o executor precisa de fato (PATH, HOME, as credenciais do próprio provider);
  - o `doctor --project` avisa quando o ambiente atual tem variáveis que casam com os padrões de scrub.

## OXB-043: o `.oxe/` na raiz do repositório pode estar velho e não há aviso

- **Status:** resolvido (1.21.2).
  - O `status` e o `doctor` mostram uma linha `.oxe/:` com a versão que o gerou, a versão em execução, a última atividade (o último evento ou a data dos arquivos do núcleo) e o programa (fase ativa e fases fechadas).
  - Fica marcado como `stale`, com o motivo e a dica, quando foi escrito por uma versão mais antiga (ou mais nova) que a em execução, ou quando está sem atividade há mais de `oxe_stale_days` (padrão 14).
  - `oxe-cc status --all-worktrees [--json]` lista o `.oxe/` de cada worktree do repositório (branch, versão, última atividade, programa e ativo/stale) para mostrar qual é o ativo.
  - Teste: `tests/oxe-1212-oxe-dir-info.test.cjs`.
- **Evidência:**
  - o checkout principal do usuário tem um `.oxe/` de setembro, com o STATE.md apontando para `docs/plans/delegation-worktree-continuity` e um ACTIVE-RUN.json de template, gerado pela 1.12/1.16;
  - a 1.5.0 roda num `.oxe/` próprio na worktree `oxespace-150`.
  - Nada no OXE diz qual `.oxe/` é o ativo nem acusa o velho.
- **Impacto:** um agente que rode `oxe-cc status` no checkout principal recebe um próximo passo de um plano morto.
- **Proposta:** o `doctor`/`status` mostram a versão que gerou o `.oxe/`, a data da última run e o programa ativo, e marcam `stale` quando a versão é anterior à instalada ou quando não há atividade há N dias. Com várias worktrees, `oxe-cc status --all-worktrees` lista cada `.oxe/` e o seu estado.

## OXB-044: o preflight do execute cobra a rubrica de autoavaliação do PLAN.md que o lint não olha

- **Status:** resolvido (1.21.2), com o OXB-041.
  - Uma passada só lista o contrato inteiro: sem a seção, a mensagem traz todos os campos, a rubrica e o `<confidence_vector>` com `<global score>` e as 6 dimensões; sem o vetor, ela já nomeia `<global score>` e cada dimensão.
  - O preflight passou a reportar a confiança e a autoavaliação incompleta juntas. Antes, `plan_confidence:missing` escondia a rubrica até a volta seguinte.
  - De quebra (achado pelo e2e-program depois da OXB-067): a detecção de mudanças passou a ser por conteúdo (`git diff HEAD` + `ls-files --others`), não por `git status`. Com `core.autocrlf=true`, um arquivo restaurado pelo rollback (CRLF) e reescrito com LF aparecia como "M" com diff vazio, e o dossiê acusava architecture_drift e bloqueava o close da fase.
- **Evidência:** com o `plan lint --dry-verify` em "ok", o `runtime execute` parou em `plan_self_evaluation_incomplete:9`. Faltavam no PLAN.md: "Alternativas descartadas", "Condição para replanejar", o bloco `<confidence_vector>` e as 6 linhas da rubrica.
- **Impacto:** é a terceira volta lint → execute → corrigir para o mesmo plano, e cada volta custa uma verificação completa (minutos, com o lock pesado da máquina).
- **Proposta:** o `plan lint` roda o mesmo `runtime_execute_preflight` em modo seco e lista todos os bloqueios de uma vez. A autoavaliação vira campo do PLAN.json (`self_evaluation`), e o PLAN.md passa a ser só uma projeção.
- **Adendo ao OXB-044:** na volta seguinte, o preflight acusou mais 2 itens que não estavam na lista anterior: `<global score>` e a dimensão `open_gaps` com esse nome exato. Na primeira volta ele só validou a presença do bloco, não o conteúdo. A validação é incremental: cada correção revela a camada seguinte.

## OXB-045: o checkpoint commit saiu como "feat: {message}" (template não preenchido)

- **Status:** resolvido (1.21.2). `{message}`, `{subject}` e `{summary}` viram o título da tarefa. Um placeholder desconhecido nunca chega ao histórico: cai no título. O `plan lint` acusa o placeholder desconhecido no template e simula a mensagem de cada tarefa contra o `pattern`. Teste: `tests/oxe-1212-gate-summary.test.cjs`.
- **Evidência:** com `commit_convention.template = "{type}({scope}): {message}"` e sem `commit` nas tarefas (`require_task_message: false`), os três checkpoints da F1 (T4, T5, T6) foram gravados literalmente como `feat: {message}`. O `plan lint` valida o `pattern`, mas não acusou que a mensagem final não teria conteúdo.
- **Impacto:** o histórico fica ilegível. O time precisa reescrever as mensagens antes de abrir os PRs, e o `OXE-Task` some se alguém fizer squash à mão.
- **Proposta:** sem `commit` na tarefa, usar o título da tarefa como `{message}`. Se o placeholder sobrar na mensagem final, falhar o checkpoint. O lint simula a mensagem de cada tarefa contra o `pattern`.

## OXB-046: o planner usou um teste de aceite de fase inteira como verify de tarefa, e o retry não percebeu

- **Status:** resolvido (1.21.1). A verificação do critério roda só na tarefa que o completa, e o lint avisa quando um verify intermediário roda o teste de aceite do critério. A comparação por conjunto de testes na régua de suspeita fica para depois.
- **Evidência:** o teste congelado do A4 confere todos os diálogos do `src/` e foi posto no verify de T8 e T9, que migram só parte deles. As duas tarefas gastaram 3 tentativas cada (US$ 13,59 no total) contra um vermelho impossível de resolver dentro do escopo delas. O retry informado reenviou a mesma saída. A régua de suspeita só para com duas falhas *idênticas*, e a contagem de arquivos mudava a cada tentativa.
- **Impacto:** custo e turnos gastos em trabalho que não podia ficar verde. Ao mesmo tempo, T9 tinha uma regressão real: um teste existente quebrou por uma mudança de comportamento pedida pelo plano, mas fora do escopo de escrita da tarefa.
- **Proposta:**
  - o dry-verify roda o verify de cada tarefa com **só os arquivos dela** num estado "feito hipotético" e acusa as asserções que dependem de arquivos de outras tarefas;
  - o lint avisa quando um teste de aceite usado no verify de uma tarefa lê arquivos (glob/walk) fora do write set dela;
  - a régua de suspeita compara o *conjunto* de testes vermelhos, não o texto inteiro da saída.

## OXB-047: `blocked_by` externo vira gate "security" pendente e trava o execute inteiro

- **Status:** resolvido (1.21.1). `blocked_by` vira `external_dependency` (sem gate humano), o preflight ignora os gates antigos dessas tarefas, `kind: verify_only`/`external_delivery` roda sem agente, e o compile destrava PRs mergeados via `gh`.
- **Evidência:**
  - As tarefas T1–T3 tinham `blocked_by: ["propagno/oxespace#594", …]`.
  - Na primeira execução, o scheduler as pulou e as outras rodaram, como diz a referência ("a tarefa espera um gate, e as demais seguem").
  - Na execução seguinte, o preflight bloqueou tudo com `pending_gates:3`. Os 3 gates tinham sido criados com o escopo `security`, porque o `inferGateScope` cai em `security` quando a tarefa só coleta evidência.
  - Não existe tarefa "só verificar": qualquer tarefa da onda vira um `claude -p` pago.
- **Impacto:** em um time onde parte da fase chega por PRs de outros papéis, o executor fica parado até o último PR externo entrar, ou o planner precisa de contornos. O contorno usado foi mover as tarefas externas para uma última onda sem `blocked_by`, rodar `execute --wave N` uma onda por vez e rejeitar os gates velhos com motivo registrado.
- **Proposta:**
  - O gate de dependência externa não entra em `pending_gates` do preflight; só trava a própria tarefa.
  - O escopo desse gate passa a ser `external_dependency`, não `security`.
  - Um `kind: verify_only` roda só o verify, sem agente e sem custo, cuja tarefa conclui quando o verify passa.
  - O `blocked_by` é consultado no GitHub a cada execute: quando o PR entra, a tarefa destrava sozinha.

## OXB-048: a tarefa ficou verde no executor e o PR quebrou no typecheck e na suíte vizinha

- **Status:** resolvido (1.21.2).
  - `task_gates` (PLAN.json e/ou config.json; o plano vence no mesmo id): `{ id, command, applies_to?, runner? }`. Cada gate é acrescentado ao verify de toda tarefa que escreve código (não roda em done, external_delivery, verify_only, spike nem em tarefa só de docs). `{files}` vira os arquivos da tarefa que casam com `applies_to` (padrão: código). Com o verify por segmento (OXB-066), o retry diz qual gate falhou.
  - `affected_suites` por tarefa roda via config `task_suite_command` (`npx vitest run {suites}`).
  - O `plan lint` valida `task_gates`. Com config `suite_rules: [{ paths, suite, reason }]`, ele avisa quando uma tarefa toca `paths` (ex.: `electron/main/db/migrations/`) sem a suíte no verify nem em `affected_suites`. Também avisa sobre `affected_suites` sem `task_suite_command`.
  - Mudar `task_gates` no config recompila o grafo (entra no source hash).
  - Teste: `tests/oxe-1212-task-gates.test.cjs` (o caso da T4: o gate de typecheck vermelho reprova a 1ª tentativa e o retry nomeia o segmento [2/2]).
  - Sugestão para o oxespace: `"task_gates": [{ "id": "tsc", "command": "npx tsc --noEmit --incremental" }]`, `"task_suite_command": "npx vitest run {suites}"` e `"suite_rules": [{ "paths": "^electron/main/db/migrations/", "suite": "tests/integration/migrations.test.ts" }]`.
- **Evidência:** a F1-T4 (`workspaces.color`, migração 093) concluiu na 1ª tentativa, run `oxe-run-mw28b0n9-3s0gda` (ledger `.oxe/runs/oxe-run-mw28b0n9-3s0gda.budget.json` na worktree oxespace-150, US$ 3,34 em 10 turnos). A revisão do BACKEND achou dois bloqueios:
  - `tests/integration/migrations.test.ts` fixa `EXPECTED_SCHEMA_VERSION = 92`, e 6 testes caem;
  - o typecheck quebra, porque `Workspace.color` passou a ser obrigatório e `mock-ipc.ts` e `ThreadGrid.tsx` não o setam.
  - O verify da tarefa só rodava os testes novos. Os `phase_gates` (typecheck, governança) rodam uma vez só, no verify da fase.
- **Impacto:** com 1.5.0 em PRs por tarefa, o PR sai antes do verify da fase. A CI e o revisor pegam o que o executor deveria ter pegado, e isso é exatamente o `post_green_crs` do scorecard.
- **Proposta:**
  - **gates leves por tarefa** (`task_gates`): typecheck incremental mais os testes relacionados (`vitest related <files>`), ambos baratos, rodados no verify de cada tarefa que escreve código;
  - o planner declara `affected_suites` por tarefa (migração → `tests/integration/migrations.test.ts`);
  - o lint avisa quando uma tarefa toca `electron/main/db/migrations/` sem a suíte de migrações no verify.

## OXB-049: a âncora existia, mas o executor desenhou os próprios ícones

- **Status:** resolvido (1.21.2), na parte de enforcement. O erro de planejamento (a âncora apontava para o HANDOFF) continua sendo do planner, mas o lint agora o expõe.
  - Uma âncora com `<action>copy</action>` e `target="<arquivo que a tarefa escreve>"` vira check automático no verify da tarefa (e no verify da fase): `node oxe-anchor-copy.cjs --anchors … --id RA-01`.
    - Com `symbols="History,Mic"`, compara cada declaração copiada com a da fonte (`path`).
    - `compare="geometry"` (padrão quando a fonte tem SVG) compara a geometria em ordem: d, points, viewBox, cx/cy/r e outras. Formatação, aspas e imports não contam.
    - `compare="exact"` compara o texto normalizado da declaração.
    - Sem `symbols`, as linhas de `snippet_ref` (ou o arquivo inteiro) precisam estar no alvo.
  - A falha nomeia o símbolo e o primeiro traço diferente (`RA-01 History: a geometria difere da fonte …`). No dry-verify, um alvo ausente é o vermelho certo, e uma cópia errada sobre um arquivo existente conta como assertion.
  - Mudar o REFERENCE-ANCHORS.md recompila o grafo.
  - O lint avisa quando uma âncora copy não tem `target` (não dá para comparar) ou aponta para uma tarefa fora do plano.
  - O template do REFERENCE-ANCHORS ganhou `target`, `symbols`, `compare` e a regra.
  - Teste: `tests/oxe-1212-anchor-copy.test.cjs`.
- **Evidência:** a F1-T5 (ícones) passou no teste congelado: um módulo por ícone, `currentColor`, `aria-hidden`. A revisão do DESIGN mostrou que 4 ícones eram cópias do Lucide sem as marcas do Mandacaru, e que o History era o relógio, não o scrubber aprovado. O desenho aprovado estava em `playground/src/components/icons.ts`, mas a âncora RA-01 apontava para o HANDOFF, não para esse arquivo, e o teste não comparava geometria.
- **Impacto:** um "verde" que não é o produto aprovado. Foi preciso o CR-02, com um teste que compara as formas desenhadas com o arquivo aprovado.
- **Proposta:** uma âncora com `action: copy` vira check automático no verify: os símbolos e trechos copiados precisam bater com a fonte (hash ou geometria). O lint também avisa quando uma tarefa de UI com `VISUAL-INPUTS` crítico não tem teste que compare saída com a fonte visual.

## OXB-050: dentro de uma onda, as tarefas que escrevem rodam em série, e o modo paralelo não prepara dependências

- **Status:** resolvido (1.21.2), opt-in com `runtime execute --parallel-mutating` (o padrão continua serial).
  - O scheduler roda em paralelo, num pool, os nós mutáveis de uma onda: até `parallel.max` (padrão 2), só com `mutation_scope` disjunto (mesmo arquivo, diretório × arquivo e glob contam como sobreposição) e só com memória livre ≥ `parallel.min_free_mb` para iniciar mais um.
  - Cada nó roda numa worktree própria (`GitWorktreeManager` com `prepare` de dependências).
  - Verify verde na worktree → integração sob lock: só os arquivos do escopo são copiados para a checkout do programa. O que ficou fora do escopo vira `ScopeViolation` (`not_integrated`). O verify roda de novo no tree integrado e só então sai o `WorkItemCompleted`, com o checkpoint. Se o verify integrado der vermelho, a integração é desfeita e a tentativa vai para o retry.
  - `deps_strategy`: `link` (junction para o node_modules de `deps_link_from`, explícito, nunca um caminho de `deps_protected`), `copy-from`, `ci` (npm ci + checagem de presença da OXB-039) ou `none`.
  - Recusado antes de qualquer turno pago: sem `--checkpoint-commits`; com working tree sujo; sem `deps_strategy`/`deps_link_from`; com fonte protegida; e, no `link`, tarefa que muda package.json/lockfile ou instala no verify ("use deps_strategy copy-from ou ci").
  - Os links saem sempre antes do remove: no dispose, e numa varredura de leases velhos no início de cada execute paralelo (`sweepStaleWorkspaces`: unlink, depois `worktree remove`, depois `prune`).
  - Teste: `tests/oxe-1212-parallel-mutating.test.cjs` (concorrência medida = 2; escopos sobrepostos nunca juntos; integração + commit por tarefa; edição fora do escopo não integrada; verify integrado vermelho desfeito; recusas; varredura com junction sem perder o node_modules real).
- **Evidência:**
  - Em `lib/runtime/scheduler/scheduler.js` (runWave, ~l. 360), só rodam juntos os nós que passam no `isConcurrentSafe` (leitura). Todo nó com `mutation_scope` cai em `for (const id of mutations) await runNode(…)`, sempre no mesmo checkout, mesmo quando os escopos de escrita são disjuntos (ex.: T8 em `src/components/Threads/*` e T9 em `src/components/OxeQuery/*`).
  - O modo paralelo existe (`--agents-plan` com `plan-agents.json` mais `MultiAgentCoordinator`, `mode: parallel`, uma worktree por agente via `GitWorktreeManager`). Só que a worktree nova nasce sem `node_modules`: o `GitWorktreeManager` não instala nem linka dependências, e só desfaz links no dispose. Os verifies (vitest, test:electron) quebram ali.
  - Somam-se o OXB-039 (o `npm ci` perde o `better-sqlite3`) e a memória da máquina: 2–4 GB livres, com a sessão já morta uma vez por pressão de memória.
- **Impacto:** a F1 roda tarefa por tarefa. É o mesmo gargalo do OXB-033, só que dentro da onda.
- **Proposta:**
  1. o scheduler roda em paralelo os nós de uma onda com `mutation_scope` disjuntos, cada um num lease de worktree, e junta tudo pelo `workspaceMergeReport`;
  2. o `GitWorktreeManager` aceita `deps_strategy` (`link` para um `node_modules` validado com junction desfeita no dispose, `copy-from`, ou `ci` com verificação de presença dos pacotes, OXB-039);
  3. a concorrência é limitada pela memória (`max_parallel` mais a memória mínima por agente), consultando o heavy-lock do projeto quando houver.

## OXB-051: no modo inplace, a tentativa falha de uma tarefa contamina a seguinte; e `--wave N` não limita a onda

- **Status:** resolvido (1.21.1). A tentativa falha é guardada em `attempts/<task>-failed/` e o escopo é restaurado (o sujo prévio fica intocado); há log por tentativa e o `--wave N` é real. O `scope_violation` explícito fica para depois.
- **Evidência:**
  - **Contaminação entre tarefas:** a T9 falhou e deixou as alterações dela (arquivos do OxeQuery) no checkout. A T8, na mesma onda, também falhou nas 3 tentativas. Rodados à mão no mesmo estado, os comandos de verify da T8 passam, então a falha veio do estado misto do checkout, não do código da T8.
  - **`--wave 1` não limita:** `runtime execute --wave 1` também rodou a T8 e a T9 (onda 2) e gastou mais US$ 5,78 nelas.
  - **Gates recriados:** as tarefas sem `files` (entregas externas) voltaram a gerar gates `security` pendentes a cada run (adendo ao OXB-047).
- **Impacto:** retries pagos que não podem passar, e um diagnóstico que só sai rodando o verify à mão. O contorno foi guardar a tentativa da T9 como patch, reverter os arquivos dela e simplificar a tarefa.
- **Proposta:**
  - no modo inplace, uma tarefa que falha tem o escopo dela revertido (stash próprio do OXE ou um branch `oxe/attempt/<task>`) antes da próxima rodar, e a tentativa fica guardada para o retry informado;
  - o verify de uma tarefa reprova por escopo, com uma mensagem explícita (`scope_violation: <arquivos fora do write set>`), em vez de cair no retry genérico;
  - o `--wave N` restringe de fato a uma onda;
  - a saída do verify de cada tentativa vai para `.oxe/runs/<run>/attempts/<task>-<n>.log`, porque hoje o journal guarda só o estado, não o motivo.

## OXB-052: o checkpoint commitou 1 dos 4 arquivos da tarefa; o resto ficou solto e reprovou as próximas

- **Status:** resolvido (1.21.1). O checkpoint usa o escopo atual (grafo + plano) e acusa `checkpoint_incomplete`. A causa era o grafo velho (OXB-053).
- **Evidência:**
  - Na run 3 da F1, a T4 (com o CR-03) passou o verify e gerou o checkpoint `583ee693`, com só `electron/main/ipc/validation.ts`.
  - O executor também alterou `electron/main/e2e/mock-ipc.ts`, `src/components/Threads/ThreadGrid.tsx` e `tests/integration/migrations.test.ts`. Os três estão no `files` da T4 e no `exact_paths` do pack, e ficaram sem commit.
  - A T8, que também mexe em `src/components/Threads/`, e a T9 falharam 3 vezes cada (US$ 2,10 e US$ 9,42).
  - Com o resto da T4 commitado à mão, os verifies das duas passam como estão (31/31 e 118/118). Elas foram fechadas com `oxe-cc plan done`.
- **Impacto:** o checkpoint perde trabalho verificado. O verify verde roda sobre arquivos que não vão para o commit, e o PR montado a partir do checkpoint sai sem o que fez o verify passar. Com o OXB-051, isso vira uma cascata de retries pagos.
- **Proposta:**
  - o checkpoint commita `git diff --name-only` ∩ `write_set` da tarefa, todos os arquivos, e falha alto se sobrar alteração do escopo fora do commit;
  - o verify roda sobre a árvore do commit (ex.: `git stash -k` do OXE, ou uma worktree no checkpoint), não sobre o checkout sujo;
  - o journal registra os arquivos de cada checkpoint, para auditoria.

## OXB-053: o execute reusa o grafo antigo e refaz tarefas `done`; o aceite do critério roda no verify de cada tarefa

- **Status:** resolvido (1.21.1). O execute recompila quando o hash do PLAN.json/PLAN.md/SPEC/pack muda, e a verificação do critério roda só na última tarefa dele.
- **Evidência:**
  - **Tarefas `done` refeitas:** depois do `oxe-cc plan done T8/T9` (com T4–T6 já `done` no PLAN.json), o `runtime execute` seguinte refez T4, T5, T6, T8 e T9 com o grafo compilado antes. Foram US$ 9,52 sem nenhuma mudança de arquivo. Só um `runtime compile` explícito montou o grafo novo, com 7 nós, pulando as `done`. A rota sugerida pelo `feedback` cita `compile`, mas o `execute` sozinho não avisa que o grafo está velho.
  - **Aceite de fase no verify de tarefa:** a causa real das 12 falhas da T8 e da T9 em 4 runs era o aceite congelado do A4, que o runtime roda no verify de **toda** tarefa ligada ao A4. Esse teste confere todos os diálogos do `src/`, então só pode passar depois da última tarefa do critério (T10). Trocar o `verify.commands` da tarefa não muda nada. A única saída foi tirar o A4 das tarefas intermediárias.
- **Impacto:** US$ 37,52 em retries que não podiam passar (T8 + T9 nas runs 1–4) mais US$ 9,52 em tarefas já prontas. A mensagem de falha nunca dizia "aceite A4 de fase".
- **Proposta:**
  - o `execute` compara o hash do PLAN.json com o do grafo compilado e recompila sozinho, ou recusa com "grafo desatualizado";
  - o aceite de um critério roda **só** quando todas as tarefas do critério estão prontas, ou na fase, e não no verify de cada tarefa. O lint mostra em que momento cada aceite congelado vai rodar.

## Evidência positiva (F1, run 7): onde o OXE funcionou bem

- Com o grafo recompilado, a árvore limpa antes da execução, o aceite de fase fora das tarefas intermediárias (OXB-053), o processo destacado do Claude Code e no máximo 2 workers de vitest, a run 7 concluiu T7, T8, T10, T11 e T2 sem retries desperdiçados.
  - Custo: US$ 19,56.
  - Os checkpoints commitaram todos os arquivos, com `git status` limpo depois.
  - As mensagens de commit vieram do campo `commit` de cada tarefa.
  - Os 3 "falhos" (T1, T3 e T12) eram entregas externas ainda não mergeadas. Foram o comportamento esperado, e a ferramenta deveria classificá-los como "aguardando externo" (OXB-047).
- O ciclo CR via `runtime feedback` funcionou bem para transformar revisão humana em teste congelado: revisão → `feedback --class defect` → teste que reproduz → reabrir a tarefa → redo. Foram 7 CRs na F1 (CR-01 a CR-07, um deles `spec_gap` com teste v2).
- Lição para o planner (vai para LESSONS): no modo inplace, comece cada execute com a árvore limpa. Guarde as tentativas falhas como patch e reverta, até o OXB-051 ser corrigido.

## OXB-054: o scorecard mostra 0,95 de 1ª tentativa numa fase em que metade das tarefas falhou várias vezes

- **Status:** resolvido (1.21.1). A 1ª tentativa é medida por tarefa sobre todas as execuções, com falhas, falhas tardias e entregas externas à parte.
- **Evidência:**
  - O `runtime scorecard` da F1 (run oxe-run-mw28b0n9-3s0gda) dá `first_attempt_rate` = 0,95, dentro da meta.
  - Na mesma run, T8 e T9 falharam 3 tentativas em cada uma de 4 execuções.
  - Os registros mostram retries em T4, T6, T8, T9 e T10.
  - Os outros números do scorecard parecem certos: `turns_on_finished_work` = 68, ou seja, tarefas `done` refeitas (OXB-053), e `post_green_crs` = 11, defeitos achados por revisão ou CI depois do verde.
- **Impacto:** a métrica de maturidade que o `doctor --release` exige passa justamente na fase com mais retries. Isso enfraquece o critério de release do próprio oxe-build.
- **Proposta:** calcular o `first_attempt_rate` por tarefa sobre todas as execuções da run (uma tarefa só conta se a 1ª tentativa da 1ª execução passou), excluir as tarefas fechadas à mão (`plan done`) e reportar à parte as tarefas externas.

## OXB-055: no Windows, o `doctor --release` acusa "wrappers dirty" com `core.autocrlf=true`

- **Status:** resolvido (1.21.2). O hash de cada wrapper no `doctor --release` normaliza CRLF→LF antes do sha256 (`sha256TextEol` em `bin/lib/oxe-release.cjs`): o mesmo conteúdo com outro fim de linha não acusa mais "wrappers dirty"; uma mudança de conteúdo continua acusando. Teste: `tests/oxe-1212.test.cjs`.
- **Evidência (publicação da 1.21.1, 04/11):** num checkout com `core.autocrlf=true`, os wrappers vêm com CRLF e o `sync-runtime-metadata` os reescreve com LF. O hash de antes e depois diverge sem nenhuma mudança de conteúdo, e o `prepublishOnly` bloqueou com "wrappers ficam dirty após sync". O CI, em Linux, não vê isso.
- **Proposta:** normalizar o EOL antes de calcular o hash dos wrappers.

## OXB-056: a CLI não roda sem `npm install` (o `semver` é carregado no startup)

- **Status:** resolvido (1.21.2). `bin/lib/oxe-semver.cjs` usa o pacote `semver` quando ele existe e, sem `npm install`, um fallback mínimo (valid, coerce, compare, gt/gte, rcompare, major/minor) que concorda com o `semver` nas versões X.Y.Z[-pre]. `oxe-npm-version`, `oxe-release` e `oxe-install-resolve` passam por ele. Uma cópia de `bin/` sem `node_modules` roda `--version`. Teste: `tests/oxe-1212.test.cjs`.
- **Evidência (TECH LEAD, 04/11):** numa worktree limpa em v1.21.1, `node bin/oxe-cc.js --version` falhou com "Cannot find module 'semver'", a partir de `bin/lib/oxe-npm-version.cjs`.
- **Proposta:** carregar o `semver` só na checagem de versão do npm, sob demanda, e falhar sem barulho quando ele não existir.

## OXB-057: a versão publicada era só a tag no git, e o npm continuava na 1.16.0

- **Status:** resolvido (1.21.1 publicada no npm em 05/11).

## OXB-058: emendar um critério de fase ainda não planejada, e a trilha de auditoria

- **Status:** resolvido (1.21.2).
  - `oxe-cc spec amend A<n> (--text|--append|--verify) --by --reason [--additive] [--phase]`: edita a linha do critério de qualquer fase e registra um CR `spec_gap` com a versão incrementada, o `amendment` (semântica da OXB-062) e `spec_edit {before, after}`.
  - `oxe-cc spec add criterion A<n> --text --verify` e `spec add requirement R<n> --text [--criteria] [--before "<cabeçalho>"]`: ids únicos e sem buraco (`--allow-gap` para pular de propósito), cada um com um registro `spec_edit` (by, reason, at, after) em changes.ndjson.
  - `oxe-cc program phase add --after Fn --title [--requirements] [--acceptance] [--scope]`: insere a seção no ROADMAP e a fase no PROGRAM.json e renumera só as fases `pending` sem plan_ref/run_id/started_at. Recusa se alguma já começou. Os registros de changes.ndjson da fase renumerada acompanham a fase. Avisa sobre menções textuais restantes em SPEC, ROADMAP e LESSONS, e sobre ids que a fase cita mas a SPEC não tem.
  - `oxe-cc program export [<pasta>]` (padrão: `program.export_dir` no config) grava SPEC.md, ROADMAP.md, PROGRAM.json e changes.ndjson com os mesmos nomes. Com `export_dir` definido, as edições acima atualizam o export sozinhas.
  - O `doctor` avisa quando `.oxe/` está no .gitignore e não há `export_dir`, com o comando exato.
  - Teste: `tests/oxe-1212-program-edit.test.cjs` (cenário de 07/11: cláusulas da A40, fase do celular F8 com A42 e a F8 antiga virando F9).
  - De quebra: o `oxe-cc plan reopen T<n>` da CLI nunca reconhecia o id (regex `/^Td+$/`); corrigido, com teste.

## OXB-059: o `runtime status` depois que o trabalho da fase terminou

- **Status:** resolvido (1.21.2). O `runtime status` lê o trabalho da fase no PLAN.json (`runtimePhaseWork`): concluídas, aguardando entrega externa e pendentes. Quando não sobra nada pendente, um run que falhou ou bloqueou aparece como "superado: o trabalho do plano foi concluído depois deste run", o promotion readiness mostra n/a, e a próxima ação é `runtime verify` → `runtime dossier --phase Fn` → `runtime program close --phase Fn` (com programa). Com trabalho pendente, a próxima ação é o `runtime execute` com a lista. O status multi-agent e a sugestão de plan-agents.json só aparecem quando existe `plan-agents.json`. O `--json` traz `phaseWork`, `runSuperseded` e `nextAction`. Teste: `tests/oxe-1212.test.cjs`.

## OXB-060: a branch do programa diverge da main; promote por tarefa

- **Status:** resolvido (1.21.2).
  - `oxe-cc runtime sync --from origin/main [--no-fetch] [--no-reverify]`: fetch do remoto e merge local (`--no-ff`, nunca push). No conflito, aborta o merge e lista os arquivos. Toda tarefa done cujos `files` mudaram na base recebe `needs_reverify`, e o verify dela roda de novo com o runner por segmento da OXB-066, sem executor. A tabela tarefa → OK ainda verde / FAIL agora vermelho mostra o segmento que falhou. Verde limpa a marca (`reverified`); vermelho reabre a tarefa. Recusa working tree sujo fora de .oxe/.
  - `oxe-cc runtime promote T<n> --base main [--branch] [--open-pr] [--remote] [--no-pr-ready]`: branch `oxe/promote-tn` a partir da base, com cherry-pick -x (na ordem do histórico) dos commits com trailer `OXE-Task: Tn` / `done_commit` e dos commits dos testes congelados dos critérios da tarefa. No conflito, aborta, apaga a branch e volta à branch do programa. Roda o `pr:ready` do projeto na ponta da branch e reporta o resultado. O corpo do PR vai para `.oxe/promote/Tn.md` (tarefa, arquivos, critérios, CRs, commits), sempre por `--body-file`. Push e `gh pr create` só com `--open-pr`; sem ele, imprime os comandos. Nunca põe label. Com `--open-pr`, recusa se a branch já existe no remoto (nada de force-push). `runtime promote` sem id de tarefa continua sendo o pipeline de promoção do run.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs` (repos locais com um bare como origin e `gh` falso).

## OXB-061: o `runtime feedback` reabre todas as tarefas do critério

- **Status:** resolvido (1.21.2). Sem `--tasks`, o CR reabre só a tarefa que fecha o critério; quando o critério tem mais de uma tarefa final, reabre essas. As outras impactadas saem em `impacted_not_reopened` ("Impactadas, não reabertas"). `--tasks T7[,T8]` escolhe quais reabrir, e um id desconhecido é reportado. Uma tarefa entregue por fora (`kind: external_delivery|verify_only`, `blocked_by`, `external_resolved` ou policy externa) nunca é reaberta e sai em `external_not_reopened`. Teste: `tests/oxe-1212.test.cjs` (cenário do CR-15: T4 é código comum entregue pelo PR #605 e só reabre com `--tasks T4`; T5 é `external_delivery` e nunca reabre; T7 é o closer).

## OXB-062: uma emenda aditiva marca todos os testes do critério como desatualizados

- **Status:** resolvido (1.21.2). O CR `spec_gap` grava `amendment: additive|changing` (`runtime feedback … --additive`; o padrão é `changing`). Numa emenda aditiva, os testes anteriores continuam válidos e o lint só exige um teste novo com `version` ≥ a emenda (e `resolves`). Numa emenda que muda o critério, todo teste de versão anterior fica stale, como antes; agora cada um é listado com o arquivo. Emendas encadeadas: só fica stale o que está abaixo da última emenda `changing`. Teste: `tests/oxe-1212.test.cjs`.

## OXB-063: o `plan lint --dry-verify` roda o verify de tarefas externas

- **Status:** resolvido (1.21.2).
  - Uma tarefa com `blocked_by` em aberto recebe o veredito `external_pending`: o verify dela não roda e ela gera aviso, não erro.
  - Antes do dry-run, o lint consulta o GitHub como o compile, então um PR já mergeado destrava a tarefa e o verify volta a rodar normalmente.
  - Teste: `tests/oxe-1212.test.cjs`.

## OXB-064: exit code 1 quando sobram só tarefas externas ou fora da onda

- **Status:** resolvido (1.21.2). O resultado do execute separa `blocked` (o que bloqueou de verdade) de `external_pending` (tarefas que aguardam entrega externa) e `out_of_scope` (fora do `--wave`). Sai com 0 quando tudo o que dava para rodar no escopo concluiu. `external_pending` aparece numa linha própria ("Aguardando entrega externa"), e com `--strict-external` sai com 3. Teste: `tests/oxe-1212.test.cjs`.

## OXB-065: encoding da saída quando o stdout não é um TTY (Windows)

- **Status:** resolvido (1.21.2). Quando o stdout não é um TTY (ou com `--plain`), a CLI não imprime banner nem box drawing e troca os glifos por palavras ASCII (`OK`, `FAIL`, `BLOCKED`, `RETRY`, `->`); os acentos continuam UTF-8 real. `OXE_PLAIN=0` força a saída decorada. O `runtime execute --json` imprime uma linha NDJSON por evento de tarefa (`{type:"task", task, attempt, status, cost_usd, total_cost_usd, failed_segment?}`), e a última linha é `{type:"result", …}`. Teste: `tests/oxe-1212.test.cjs`. No pwsh 7, `[Console]::OutputEncoding = [Text.UTF8Encoding]::new()` antes do `*>> log` faz os acentos chegarem certos no log.

## OXB-066: o feedback do verify esconde o segmento que falhou num comando `a && b`

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 07/11, na 1.21.1 via `npx oxe-cc@1.21.1`. O verify da tarefa roda cada segmento `&&` sozinho, parando no primeiro que falha. O retry e o `output_tail` nomeiam o segmento que falhou (`Failing segment [2/2]: …`) e trazem só a saída dele. O `VerificationCompleted` leva `failed_segment {index,total,command,exit_code}`, e `attempts/<Tn>-<n>.log` guarda todos os segmentos com cabeçalho. Teste: `packages/runtime/tests/verify-segments.test.ts`.
- **Evidência:** a run oxe-run-mw28b0n9-3s0gda, tarefa T13, tinha o verify `npx vitest run … && npx tsc --noEmit -p tsconfig.json`.
  - O vitest passou (39/39) e o tsc falhou.
  - O `output_tail` do WorkItemBlocked e todos os `attempts/T13-n.log` só têm a saída do vitest, mais "Fix the code so this exact command passes". O erro do tsc nunca aparece.
  - Foram 4 tentativas, US$ 4,54 e 0 concluídas: o executor nunca viu o erro.
- **Proposta:**
  - no verify, rodar cada segmento do `&&` sozinho, como o dry-verify já faz (OXB-018);
  - dizer qual segmento falhou;
  - mandar ao executor o fim da saída desse segmento, nunca o fim do fluxo inteiro.

## OXB-067: o rollback de uma tentativa falha deixa edições fora do escopo

- **Status:** resolvido (1.21.2). O runtime tira um snapshot da árvore (caminho → hash) quando a tarefa começa e a cada tentativa. Quando a tentativa termina, todo caminho alterado fora de `files` emite `ScopeViolation {task, paths, outcome}`, tenha ela passado ou não. Se a tarefa falhar de vez, esses caminhos são salvos (patch e arquivos novos em `attempts/<Tn>-failed/`) e restaurados junto com o escopo. O que já estava sujo antes da tarefa nunca é revertido; vai para `dirty-before/`. Se a tarefa passar, o checkpoint não leva o arquivo de fora e o `checkpoint_incomplete` lista o arquivo em `scope_violation`. Teste: `tests/oxe-1212.test.cjs`.
- **Evidência:** na mesma run, o RollbackExecuted restaurou os 8 arquivos do escopo da T13.
  - O executor também tinha editado `src/components/Threads/ThreadView.tsx`, que estava fora de `files`, porque o plano o esqueceu.
  - Essa edição ficou na árvore.
- **Proposta:**
  - salvar em `attempts/<Tn>-failed` e restaurar também os arquivos alterados fora do escopo;
  - emitir `scope_violation` nos eventos quando o executor edita fora de `files`.

## OXB-068: a tarefa verify_only emite o aviso "may write files" e não tem escopo vazio obrigatório

- **Status:** resolvido (1.21.2).
- **Evidência (TECH LEAD, 07/11, `npx oxe-cc@1.21.1 runtime execute --wave 5` em oxespace-150):** todo nó `verify_only` emitiu `PolicyWarning empty_mutation_scope: "node may write files but declares no mutation_scope; running serially and without scope checks"`. Por definição, uma tarefa verify_only ou external_delivery não deve escrever arquivo.
- **Correção:**
  - o nó verify_only ou com dependência externa tem escopo vazio obrigatório: qualquer arquivo que o verify dele escreva emite `ScopeViolation` com `verify_only: true` e é desfeito, pelo mesmo mecanismo do OXB-067;
  - o aviso `empty_mutation_scope` não é mais emitido para esses nós.
- **Teste:** `tests/oxe-1212.test.cjs`.

## OXB-069: o verify da fase checa os critérios de todas as fases

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (rc.2, oxespace-150 F1, run oxe-run-mw28b0n9-3s0gda): com a F1 ativa, o VERIFY.md listou "GAP Critério A7 … A47: Como verificar não é executável" para 38 critérios de F2–F9, ainda sem plano, e a cobertura ficou em 90%.
  - Com programa e fase ativa, a suíte do verify (no compile e no `runtime verify`) usa só os critérios do `acceptance` da fase no PROGRAM.json, mais os que as tarefas do plano referenciam.
  - Os outros viram uma linha só: "Fora da fase F1: 38 critério(s) de F2–F9 ainda não planejados — não verificados nesta fase".
  - Sem programa, nada muda.
  - Teste: `tests/oxe-1212-verify-scope.test.cjs`.

## OXB-070: o resumo do CR de um gate mostra as linhas erradas

- **Status:** resolvido (1.21.2). O resumo de um gate vermelho (CR e motivo do close) pega as linhas que reprovam: eslint `N:M error` (com o arquivo do bloco), tsc `error TS`, FAIL/×/not ok/AssertionError, npm ERR! e linhas que começam com "error". Warnings do eslint nunca entram, e a contagem ("✖ 219 problems (2 errors, …)") fecha o trecho. Sem marcador, usa as últimas linhas da saída. Teste: `tests/oxe-1212-gate-summary.test.cjs` (o caso do CR-16). Registrado pelo TECH LEAD em 08/11: o CR-16 (gate lint) trouxe o primeiro warning de 217 ("285:3 warning … Cannot access refs during render"); a falha real eram 2 linhas `error` (no-explicit-any) no fim.
- **Proposta:** o resumo usa as linhas que reprovam (eslint `error`, tsc `error TS`, vitest `FAIL`/`×`, ou as últimas linhas de um exit ≠ 0), nunca o começo do stream.
- **Nota (baixa prioridade):** gate `requires: ["build"]`, ou um aviso do lint quando o gate lê saída de build que nada produz (o gate bundle falhou com ENOENT out/main).

## OXB-071: `acceptance_not_frozen` em testes congelados adicionados depois do compile

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (rc.3, verify da F1): 10 testes congelados (a4, a5, a6, a8 ×2, a9, cr03, cr05–07, cr06…) saíram como "acceptance_not_frozen … (não existia no compile)". Eles tinham entrado depois, por CR ou edição do plano, e estão no `acceptance_tests` do PLAN.json.
  - O lock da run passa a ser consultado por arquivo, não por `id`/`criterion`. Antes, dois testes do mesmo critério sem `id` colidiam (A8 ×2).
  - Um arquivo que o plano atual declara mas o lock da run não conhece é congelado no momento do verify, com o hash atual, e entra no lock (`late_frozen_at`). Uma edição posterior dele sai como `acceptance_tampered`.
  - Teste: `tests/oxe-1212-verify-lock-timeout.test.cjs`.

## OXB-072: `spawnSync cmd.exe ETIMEDOUT` nos checks do verify

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: check-a5, check-a8 (`npm run test:electron`) e check-task-t13 caíram por timeout. O cold start do Electron mais o vitest passam de 1–2 min.
  - O limite por check no `runtime verify` vem de `--timeout-ms`, depois de config `verify_timeout_ms` e por fim do padrão de 10 min (antes, 60 s do runtime). Um teste de aceite pode declarar `timeout_ms` no PLAN.json.
  - Um check morto pelo timeout sai como `status: error` com `timed_out: true` e a mensagem "timeout: passou de Ns sem terminar — aumente verify_timeout_ms (config) ou o timeout_ms do teste de aceite", nunca como FAIL.
  - Teste: `tests/oxe-1212-verify-lock-timeout.test.cjs`.

## OXB-073: `proof_not_executed` com todos os testes verdes (proves parafraseado)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (rc.4, verify da F1): check-accept-a8 (cr15-selected-workspace-tint) e check-accept-a5 (cr10-cr14-f1-close) saíram como `proof_not_executed`, embora os arquivos passem 8/8 e 4/4.
  - **Causa:** os `proves` do PLAN.json eram paráfrases dos títulos, não os nomes dos testes. Exemplo: "the selected-state ratchet (LIMIT_SELECTED) stays at 22 or lower, never raised" × o teste "the selected-state ratchet stays at 22 or lower (never raised)". O verify estava certo; o defeito era só aparecer no verify, sem os nomes reais.
  - O `plan lint` compara cada `proves` com os títulos de `it`/`test` declarados nos arquivos do teste de aceite. Uma prova sem teste correspondente vira erro antes da execução, com a lista dos títulos declarados.
  - O `proof_not_executed` do verify passou a listar os testes que passaram.
  - Conferido (só leitura) no PLAN.json do oxespace-150: pega exatamente A8/cr15 e A5/cr10–14 (4 + 4 provas), e nenhuma das outras 11 entradas com `proves`.
  - Teste: `tests/oxe-1212-verify-lock-timeout.test.cjs`.

## OXB-074: falso positivo na checagem de presença (opcionais nativos do ssh2)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (rc.6): o `plan lint` falhou com buildcheck, cpu-features e nan (os aceleradores opcionais do ssh2, cujo build C++ falha no Windows e que o npm descarta como "failed optional dependency"). O ssh2 funciona sem eles, e o native_check do app passa.
  - Um pacote `optional: true` ausente vira aviso ("opcional(is) ausente(s) …"). Só um não opcional ausente bloqueia. A quebra nativa real (o better-sqlite3 da OXB-039) é tarefa do `native_check` do projeto.
  - Config `deps_optional_ignore` silencia o aviso por nome.
  - Conferido (só leitura) no oxespace-150: o ambiente sai `ok`, com aviso só para os 3 opcionais.
  - Teste: `tests/oxe-1212-deps-present.test.cjs`.

## OXB-075: `spec add requirement` não enxerga requisitos em bullets

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11, no primeiro uso real dos comandos da OXB-058: a SPEC do 1.5.0 lista requisitos como `- **R10** — texto (A…)`, e o comando dizia "o próximo é R1".
  - Os requisitos são lidos nos dois formatos: tabela `| R-ID |` e bullets `- **R<n>** —`, com linhas de continuação indentadas.
  - O novo entra no formato que a SPEC já usa: um bullet no mesmo estilo, depois do bloco do último. O id é checado (único e sem buraco) contra os dois formatos.
  - Teste: `tests/oxe-1212-program-edit.test.cjs`.

## OXB-076: não havia como editar uma fase existente

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: dobrar A53–A60 em fases pendentes e mover a A3 da F1 para a F11 exigiu editar o PROGRAM.json e o ROADMAP à mão.
  - `oxe-cc program phase edit Fn [--title] [--add-requirements] [--remove-requirements] [--add-acceptance] [--remove-acceptance] [--scope] --by` edita o PROGRAM.json e a seção do ROADMAP juntos (título no cabeçalho e as linhas **Requisitos**, **Critérios de aceite** e **Escopo**), registra um `program_edit` com antes e depois e atualiza o export.
  - Adicionar só vale numa fase não iniciada. Uma fase fechada é recusada (use CR). Um critério que pertence a outra fase aponta para o `criterion move`.
  - Remover da fase ativa tira o critério do plano atual: os testes de aceite dele, ele das tarefas, e a tarefa pendente que ficar sem critério. É recusado se outra tarefa depende dela ou se ela já tem checkpoint.
  - `oxe-cc program criterion move A<n> --from Fn --to Fm` checa as duas edições antes de escrever. Escreve PROGRAM, ROADMAP e plano juntos, e os CRs só daquele critério acompanham a fase.
  - Teste: `tests/oxe-1212-program-edit.test.cjs`.

## OXB-077: o dossiê conta merges da base como `architecture_drift`

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11, no close da F1: workflows e docs que vieram da main (por `runtime sync` e pelos merges à mão a93d6278/ec2dde86) apareceram como "tocados fora do contrato".
  - Quando a faixa da fase tem merges, um arquivo commitado só conta se um commit não-merge do histórico próprio da fase (first-parent) o tocou. O que entrou só pelo merge da base não é trabalho da fase.
  - Sem merges na faixa, nada muda.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs`.

## OXB-078: um CR de gate órfão não tinha como fechar

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: o CR-17 (`phase_gate:bundle`) continuou aberto depois que o gate `bundle` saiu do `phase_gates`, e bloqueava o close.
  - No verify e no close, um CR de gate cujo gate não está mais declarado vira `withdrawn` ("gate … removido do plano"). A lista de declarados é lida mesmo com `--no-gates`, então um verify sem gates nunca retira CR por engano.
  - `oxe-cc runtime feedback resolve|withdraw CR-<n> --by <papel> --reason "…"` fecha à mão, registrado (quem, por quê, quando). É recusado sem motivo ou se o CR já está fechado.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs`.

## OXB-079: o close dizia "verify não concluído (status: running)" logo depois de um verify aprovado

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (verify da rc.7 aprovado às 02:53, close às 03:10).
  - **Causa:** um execute que termina `completed_with_external_pending` (OXB-064) fica gravado na run como `blocked`. O verify só considerava `completed` uma execução concluída, então um verify aprovado devolvia a run para `running`.
  - **Agora:** o verify considera a execução concluída também quando o trabalho do plano (PLAN.json, OXB-059) está todo feito ou só aguarda entrega externa. Ele também grava o próprio resultado (`verification_status`, `verified_at`), e o close usa esse resultado.
  - As edições de programa em outras fases (`phase add/edit`, `criterion move`) não tocam o estado do verify da fase ativa. O `criterion move` só muda o PLAN.json quando a fase de origem é a ativa.
  - Teste: `tests/oxe-1212-verify-scope.test.cjs`.

## OXB-080: testes congelados estacionados para fases seguintes contam como `architecture_drift`

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (close da F1 na rc.9): testes revisados para trabalho posterior (o F2 antigo e o bug do plan-label), commitados de propósito na branch do programa, bloqueavam o close.
  - Arquivos adicionados ou modificados sob os globs de `parked_tests` (padrão `tests/acceptance/**`) que não são do plano atual saem como "Testes congelados estacionados (para fases seguintes)" no `architecture.md`, não como drift.
  - `program close --accept-drift <glob> --by <papel> --reason "…"` registra uma exceção auditada (`drift_waiver` no changes.ndjson). Os arquivos cobertos saem em "Fora do contrato aceitos".
  - O resto continua sendo drift.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs`.

## OXB-081: o `runtime verify` teria derrubado o anexo de CI

- **Status:** não é defeito (diagnosticado em 08/11, só leitura do oxespace-150).
  - O CR-31 ("nenhum run de CI anexado à fase F1") foi aberto pelo verify às 06:10:16. O primeiro anexo em `program/ci.ndjson` é de 06:18:59, e o segundo de 06:40:05.
  - O verify rodou antes do anexo existir. O `ci.ndjson` é append-only, e nenhum comando o apaga: os dois registros continuam lá.
  - O CR-31 fechou sozinho (06:39:38, "gate do projeto ci verde") quando o gate ficou verde.

## OXB-082: `program phase edit Fn --scope` deixa os bullets do escopo antigo no ROADMAP

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (planejamento da F2 na rc.10): a F3 ficou com a linha `**Escopo:**` nova (H1/H2) e os bullets antigos ("O OxePost para agentes, T64…"), contraditórios. Foi preciso editar à mão e registrar um program_edit.
  - `--scope` agora substitui o escopo inteiro: a linha e a lista de bullets logo depois dos campos da seção (com continuações e linhas em branco internas). O que vem depois, como `### Notas`, fica intacto.
  - Os bullets removidos aparecem num aviso e no registro `program_edit` (`scope_bullets_removed`). `--keep-bullets` mantém o comportamento antigo.
  - `--scope-file escopo.md`: as linhas que não são bullet viram o texto do `**Escopo:**` e os bullets viram a lista nova, num passo só.
  - Teste: `tests/oxe-1212-program-edit.test.cjs`.

## OXB-083: `program export <pasta>` lia o posicional como saída, e todo outro comando o lê como projeto

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: `oxe-cc program export .` gravou SPEC.md, ROADMAP.md, PROGRAM.json e changes.ndjson na raiz da worktree do programa, sujando-a, e ignorou o `program.export_dir`.
  - O posicional agora é a pasta do projeto, como nos outros comandos. A saída é `--out <pasta>`, e o padrão é o `program.export_dir`.
  - A raiz do projeto é recusada como saída. Um posicional sem `.oxe/` (o uso antigo, `program export docs/oxe`) falha dizendo para usar `--out docs/oxe`.
  - Teste: `tests/oxe-1212-program-edit.test.cjs`.

## OXB-084: `plan lint --dry-verify` ficava mudo por muito tempo, e uma rodada interrompida não retomava

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: num plano de 18 tarefas (~220 comandos de verify), o log ficou só com a linha de início por mais de 30 min. O processo morreu duas vezes pelo reaper de memória do host, e cada reinício voltava do zero.
  - **Progresso:** uma linha por comando no stderr (`[n/N] T5 <cmd> ... ok 12s`), com cabeçalho do total. O `--json` no stdout continua limpo, e `--quiet` desliga o progresso.
  - **Retomada:** cada resultado é gravado em `.oxe/cache/dry-verify.json` logo depois do comando, com a chave pela árvore (HEAD + diff de conteúdo + hash dos arquivos não rastreados). `--resume` pula o que já deu vermelho certo ou já verde nessa árvore. Timeout e comando quebrado rodam de novo. Mudou a árvore, nada é reaproveitado.
  - **Subconjunto:** `--only T5,T6` roda só essas tarefas. `--changed` roda só as tarefas cujo verify ou arquivos mudaram desde o último dry-run. Uma rodada parcial avisa quais tarefas ficaram de fora.
  - `--resume`, `--only` e `--changed` já ligam o `--dry-verify`.
  - Teste: `tests/oxe-1212-dryrun-resume.test.cjs`.

## OXB-085: uma tarefa não podia depender de algo fora do plano

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: a T13 (remover o AI Memory) tinha que esperar o merge de um PR de workflow (#686). Só cabia nas `notes`, e o TL segurava o lançamento à mão.
  - `blocked_by` agora aceita também uma pré-condição em forma de objeto:
    - `{ "kind": "pr", "ref": "#686", "until": "merged"|"closed" }`. O ref pode ser `#n` (do repositório atual), `owner/repo#n` ou a URL do PR.
    - `{ "kind": "commit", "ref": "<sha>", "branch": "origin/main" }`, cujo padrão é origin/main, main, origin/master ou master. A checagem é local, então rode `git fetch` antes.
    - `{ "kind": "file", "ref": "caminho" }`.
  - O compile (execute) e o `plan lint` checam a pré-condição antes de começar a tarefa. Se não estiver satisfeita, só essa tarefa fica parada, com o motivo `depende de #686 (PR mergeado)`. O execute e o `status` mostram `T13 aguardando: #686 (PR mergeado)`.
  - A tarefa continua sendo trabalho do plano: fica `pending`, nunca conta como entrega externa, os `task_gates` continuam valendo para ela e a fase não fecha sem ela. Um texto em `blocked_by` continua significando "entregue por outro caminho".
  - O lint rejeita objetos inválidos com a dica (kind desconhecido, ref ausente, until inválido).
  - Teste: `tests/oxe-1212-preconditions.test.cjs`.

## OXB-086: juntar planos por papel

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: BACKEND e FRONTEND escreveram cada um um arquivo de tarefas para as mesmas remoções (rid R5, ids R5 e FE-R5). O merge precisou de um script de 150 linhas, e bateu em `criteria` em prosa e em `proves` em forma de dicionário.
  - `oxe-cc plan merge backend.json frontend.json [--key rid] [--out .oxe/PLAN.json] [--force] [--json]`. Sem `--out`, imprime o PLAN.json. Com `--out`, não sobrescreve sem `--force`.
    - Tarefas com a mesma chave viram uma: união de files, verify (aceito como `{commands}`, lista ou texto), acceptance e notes (com o papel como prefixo). Os títulos diferentes vão para as notes, e os papéis ficam em `roles`.
    - `depends_on` usa a chave e vira T ids. A onda é a profundidade na cadeia de dependências, e os ids T1…Tn seguem a onda e depois a ordem de aparição.
    - Critério em prosa (`criteria` ou `acceptance` que não é A<n>) vai para as notes, com aviso.
    - `proves` em dicionário (`{ arquivo: [títulos] }`) entra na entrada de `acceptance_tests` que congela o arquivo. Se ela não existe, uma nova é criada quando a tarefa tem um só critério e um verify que cita o arquivo. Senão, é erro com a causa.
    - Entradas iguais de `acceptance_tests` (critério + arquivos + comando) viram uma, com a união dos proves.
    - Chave ausente, dependência inexistente e ciclo são erros com o nome do arquivo e da tarefa. O resultado passa pelo schema do PLAN.json antes de ser gravado.
  - O schema do plano por papel está em `oxe/schemas/role-plan.schema.json`.
  - O lint do PLAN.json agora nomeia o valor ruim: `"a tela some do menu" não é id A<n> — critérios são ids A da SPEC; a prosa vai em "notes"`. Para `proves` em dicionário, a dica aponta o `plan merge`.
  - Teste: `tests/oxe-1212-plan-merge.test.cjs`.

## OXB-087: acrescentar tarefas a uma fase depois que o execute começou

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: o HML achou 4 lacunas (G1–G4) com o plano da F2 congelado e o execute encadeado. A única saída era um segundo plano na mesma fase depois do fim da primeira run.
  - `oxe-cc plan append --from extra.json --by <papel> --reason "…"` acrescenta um lote ao PLAN.json da fase ativa, também com um execute rodando.
    - Os ids do lote são renumerados depois do último T<n> (G1 → T3), e o id original fica em `batch_ref`. Um `depends_on` interno acompanha a renumeração. Um `depends_on` que não é do lote precisa ser uma tarefa do plano.
    - As ondas do lote são deslocadas para depois da última onda do plano, então rodam depois das tarefas em voo.
    - Os `acceptance_tests` do lote são acrescentados.
    - O PLAN.json passa a ter `batches` (quem, por quê, quando e de onde), e o `changes.ndjson` ganha um `program_edit` do tipo `plan_append`.
  - **Mesmo lint:** o lote passa pelo schema e depois pelo `plan lint`. Um erro que o lote **introduz** desfaz a gravação, e nada fica no disco. Os erros que o plano já tinha não são do lote e saem como aviso.
  - **Concorrência:** as escritas no PLAN.json (o `done` gravado pelo execute e o `plan append`) passam pela mesma trava (`PLAN.json.lock`, assumida se tiver mais de 30 s), então uma não apaga a outra.
  - O execute em andamento termina o próprio grafo. O próximo `runtime execute` recompila a mesma run, pula as tarefas feitas e roda o lote. A fase só fecha com todas as tarefas de todos os lotes feitas.
  - Teste: `tests/oxe-1212-plan-append.test.cjs`.

## OXB-088: uma tarefa de remoção não satisfaz a regra de `symbols` do IMPLEMENTATION-PACK

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (lint da F2 na rc.10): a F2 tem 16 tarefas de remoção, e a regra "≥ 1 símbolo por arquivo de código" do pack não tinha como ser cumprida por um contrato de ausência.
  - O pack ganhou dois campos por tarefa: `removed_paths` (caminhos que não podem existir depois da tarefa) e `symbols_removed: [{ name, path }]` (export ausente, ou arquivo removido).
  - Os caminhos de código cobertos por eles não exigem `symbols`. `symbols` só é exigido para o que a tarefa acrescenta ou mantém, e a mensagem sugere os campos de remoção.
  - **Checagem estática nos dois sentidos:**
    - a presença continua com `files_exist`/`exports_expected`, mas um caminho removido nunca vira `files_exist`;
    - a ausência é um check no verify da tarefa (`oxe-pack-removed.cjs --pack … --task T14`), que lê os exports reais do módulo.
    - Antes da tarefa, o check é o vermelho certo (assertion), inclusive no dry-verify.
  - O lint avisa quando o pack é de outra fase (`IMPLEMENTATION-PACK é da fase F1, e o plano é da F2`), e o erro de tarefa fora do pack diz isso: `T14: tarefa mutável sem entrada no IMPLEMENTATION-PACK (o pack é da fase F1)`.
  - Teste: `tests/oxe-1212-pack-removal.test.cjs`.

## OXB-089: o lint rodava o dry-verify de 220 comandos antes de mostrar erros estruturais

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: 78 erros estruturais (teste de aceite no escopo da tarefa, duas tarefas da mesma onda no mesmo arquivo, tarefas fora do pack) saíram só no fim, 97 minutos depois.
  - O dry-verify agora roda por último, e só quando as checagens estruturais (schema, lint, pack, racionalidade e preflight) passam. Senão, o lint diz "N erro(s) estrutura(is); dry-verify não rodou" (no resultado e no progresso).
  - `--dry-verify-anyway` roda mesmo assim.
  - Teste: `tests/oxe-1212-dryrun-resume.test.cjs`.

## OXB-090: o lint da fase ativa reprovava por emendas de critérios de outras fases

- **Status:** resolvido (1.21.2, rc.13). Registrado pelo TECH LEAD em 08/11, e bloqueava a F2: 14 erros `A8@v2: emenda sem teste de aceite` por emendas (CR-21..32) de critérios de F1 (fechada), F3, F8, F9 e F11. Os critérios da F2 eram só A48 e A57.
  - A checagem de emenda do `plan lint` cobre só os critérios da fase ativa (PROGRAM.json). Sem programa, nada muda.
  - O `program status` mostra uma vez a emenda feita num critério de fase fechada depois do close: "F1 fechada com emenda depois do close — reaberto? A8@v2 (CR-21)".
  - A rc.13 saiu com o filtro do lint, e só ele, sobre a rc.12.
  - Teste: `tests/oxe-1212-amend-scope.test.cjs`.

## OXB-091: um critério que vale em todo close de fase

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: A70 ("visual totalmente polido, erros na interface não serão admitidos", palavra do usuário) é um gate de UI por fase, mas `program phase edit F4 --add-acceptance A70` falhava com "A70 já pertence a F3".
  - `program.standing_acceptance: ["A70"]` no `.oxe/config.json`, ou `oxe-cc spec add criterion A70 … --standing`, que grava lá, torna o critério permanente.
  - **No close:** toda fase exige um sign-off **daquela fase** com evidência (`oxe-cc runtime signoff --phase F4 --criteria A70 --by design --evidence <relatório>`). Um sign-off de outra fase ou sem evidência não conta, e não dá para adiar: "erros na interface não serão admitidos". Os sign-offs ficam registrados por fase em `signoffs.ndjson`.
  - **No lint:** o critério permanente nunca é "de outra fase", nunca é "A* da fase sem tarefa" e não exige teste congelado (a prova é o sign-off).
  - **No verify:** ele fica no escopo de toda fase.
  - O `program phase edit --add-acceptance A70` é recusado com a explicação.
  - Teste: `tests/oxe-1212-standing.test.cjs`.

## OXB-092: sinais de produção viram intenção nova (ADLC)

- **Status:** resolvido, versão mínima (1.21.2). Proposta do oxe-build depois da pergunta do usuário "o oxe-build é um ADLC?": o ciclo só fechava pela mão de alguém. A versão mínima foi aprovada pelo TECH LEAD em 08/11.
  - `oxe-cc runtime signal --from <relatório do HML>|<url de issue>|github:<owner/repo> [--by <papel>] [--dry-run] [--any-label]`.
  - **Relatório do HML** (markdown ou JSON): cada achado `HML-F<n>-<m>` vira um CR (`defect`, ou `spec_gap`/`constraint` com `[spec_gap]`) **na fase F<n>**. O critério vem de um destes, nesta ordem:
    - o A* citado no achado;
    - a rastreabilidade A* → T → arquivos (arquivos citados entre crases → tarefas do plano que são donas deles → os critérios delas);
    - os critérios permanentes (A70, OXB-091).
  - Sem critério, o achado vai para triagem e nenhum CR é criado.
  - **Issues do GitHub:** uma URL (exige o label `bug`; `--any-label` libera), ou `github:<owner/repo>`, que importa todas as abertas com o label bug. Tudo via `gh`, sem integração ao vivo.
  - Um achado de fase **fechada** não vira CR aqui, porque isso reabriria a fase. Ele sai com o comando `runtime feedback` pronto, e a sugestão de "reabrir?" fica para depois do 1.5.0.
  - Reimportar o mesmo relatório não duplica nada (registro `signal` com o id do achado). `--dry-run` mostra sem gravar.
  - **Depois do 1.5.0:** crash reports do app (caminho opt-in de diagnóstico) e a sugestão de reabrir fase fechada.
  - Teste: `tests/oxe-1212-signal.test.cjs`.

## OXB-093: gate de deploy

- **Status:** resolvido (1.21.2). Aprovado pelo TECH LEAD em 08/11 para a F11: o release 1.5.0 é um deploy (tag → workflow de release → GitHub release com instaladores e latest.yml → APK), com checks pós-deploy (install-over a partir da 1.4.3 em Windows/Linux, a passada empacotada do HML #702 e a spec A40 de upgrade com dados).
  - `oxe-cc runtime deploy --attach <env> --version <v> --ref <tag|url do release> [--check "<cmd>"]… [--phase Fn] [--by <papel>]` registra o deploy em `program/deploy.ndjson` como evidência da fase e roda os checks pós-deploy, cada um com id, exit, horário e duração. A saída é 1 se algum check ficar vermelho.
  - **Nunca faz o deploy.** Um `--check` que faria o deploy é recusado (git tag/push, gh release create/upload/edit, npm publish, release.mjs, gh workflow run, docker push, kubectl apply/rollout, terraform apply). Tags e aprovações ficam com TL e coordenador.
  - `phase_gates: [{ "id": "release", "kind": "deploy", "env": "github-release", "version": "1.5.0", "checks": ["install-over", "hml-packaged"] }]` roda no `program close`. O gate é verde quando a fase tem deploy daquele ambiente/versão, sem check vermelho (vale o resultado mais recente de cada comando, então um re-attach conserta) e com todos os checks exigidos já rodados (casados por trecho do comando).
  - A evidência entra no dossiê da fase como `deploy.md` (ambiente, versão, ref e a tabela de checks).
  - Teste: `tests/oxe-1212-deploy-gate.test.cjs`.

---

# Roteiro de excelência (08/11)

Pedido do usuário, enviado pelo TECH LEAD. Os itens estão em ordem de prioridade.

- Achados do execute da F2 sempre furam a fila.
- Um relatório por item, com testes.
- Uma versão de teste (rc) a cada 2–3 itens.
- Nada é publicado antes do OXESpace 1.5.0.

Cada bloco tem uma meta medível:

- **A. Verificação rápida:** o dry-verify da F2 (318 comandos, ~2h) cai para menos de 20 min, e o verify de uma tarefa para menos de 5 min.
- **B. Planejamento barato:** o plano da fase sai dos arquivos de papel com UM comando, sem scripts do TL.
- **C. Versões estáveis:** uma versão estável por fase fechada do OXESpace; RC só para hotfix.
- **D. Ciclo sem pessoa:** a fase vai do execute ao PR mergeado sem passo humano.
- **E. System design upstream:** a pergunta do usuário.
- **F. Modelo flexível:** nenhum caso novo exige mudança no código do OXE.
- **G. Escala provada:** sem código agora. O TL manda as métricas da F2.

## OXB-094: agrupar os comandos vitest de uma tarefa (e de uma onda no dry-verify) num processo só

- **Status:** resolvido (1.21.2).
  - **Verify da tarefa:** os segmentos `vitest run <arquivos>` com o mesmo runner e as mesmas flags viram um processo só, sem mudar o significado (todos precisam passar). O resto do comando fica no lugar. Vale no grafo e na suíte do verify (`verify_batched_from` guarda o original).
  - **Dry-verify:** os segmentos vitest de todas as tarefas da rodada são agrupados por runner+flags (até 60 arquivos por lote) e rodam com o reporter JSON do vitest. Cada segmento recebe o veredito do(s) seu(s) arquivo(s), como antes, com a linha `... ok (lote)`.
    - Sem relatório JSON, ou com arquivo fora do relatório, o segmento roda sozinho.
    - O `--resume` reaproveita os resultados do lote.
    - `batch: false` mantém o comportamento antigo.
  - Só formas simples são agrupadas: `[npx|pnpm|npm exec|yarn] vitest run [flags] <caminhos>`, sem aspas, pipes nem filtros que não sejam caminho.
  - Smoke com o vitest 5 real: um processo para 3 arquivos, com import ausente → `missing_target` e arquivo verde → `already_green`.
  - Teste: `tests/oxe-1212-vitest-batch.test.cjs`.

## OXB-095: comandos de tarefas diferentes em paralelo no dry-verify

- **Status:** resolvido (1.21.2).
  - No dry-verify, os lotes de vitest e os comandos que sobram (cada comando distinto uma vez) rodam em paralelo num pool. O limite é `parallel.max` do config (padrão 2), e um processo novo só começa com memória livre ≥ `parallel.min_free_mb`; o primeiro sempre começa.
  - Os vereditos continuam por tarefa, na ordem do plano. O progresso sai à medida que cada comando termina (`[n/N] … exit 1 3s`, e `(paralelo)` na linha da tarefa). Com `max: 1`, o caminho continua serial.
  - O pool roda num processo auxiliar (`oxe-parallel-run.cjs`), então a API do `plan lint` continua síncrona.
  - Teste: `tests/oxe-1212-dryrun-parallel.test.cjs`: 3 comandos de 1 s com max 3 terminam em menos de 2,6 s, com os mesmos vereditos do modo serial.

## OXB-096: teste congelado de tarefa FUTURA: só coleta e um motivo de vermelho certo

- **Status:** resolvido (1.21.2) com base nos dados da F2 (364 comandos, 318 distintos: 304 vitest simples, 28 `npm run test:electron -- <arquivo>`, 14 typecheck, 13 lint, 5 outros).
  - Um comando idêntico (typecheck, lint ou um teste de integração compartilhado) roda **uma vez por rodada**, e cada tarefa é classificada contra os próprios alvos. Entre rodadas, o cache por árvore (`--resume`, OXB-084) já evita repetir.
  - `npm run <script> -- <arquivos>` entra no lote como o vitest direto (a chave é o script). lint, typecheck, build e check nunca entram em lote.
  - O teste congelado de tarefa futura cai no lote de vitest e falha no import (vermelho certo) sem rodar a suíte inteira. Arquivo repetido no mesmo lote roda uma vez só.
  - Teste: `tests/oxe-1212-vitest-batch.test.cjs`.

## OXB-097: `oxe-cc plan build --from <arquivos de papel…>`

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Grava PLAN.json, PLAN.md e IMPLEMENTATION-PACK juntos.
  - Cobre o `plan merge`, monta as ondas pela sobreposição de arquivos (arquivo quente serializa sozinho) e tira os arquivos de aceite dos escopos.
  - Os symbols saem dos imports dos testes congelados e dos caminhos deleted/edited/created do papel. Os contracts saem dos symbols.
  - O pack e o PLAN.md levam a `phase`.

## OXB-098: `oxe-cc plan check-role <arquivo>`

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Validador que os agentes rodam ANTES de passar o plano ao TL.
  - Checa os títulos exatos dos proves, prosa × ids A, a existência dos caminhos deleted/edited num ref e a forma do verify.

## OXB-099: `oxe-cc spec freeze --from <PR|sha> [--paths glob]`

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Importa os testes congelados para o programa e checa os títulos dos proves.
  - Recusa a mudança de um arquivo já congelado sem CR e registra a origem (PR, sha).

## OXB-100: dois canais, `next` (RC) e `stable`

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - `stable` é promovido só depois que uma fase do OXESpace fecha naquela build.
  - Cada versão leva CHANGELOG e nota de migração de config (`oxe-cc doctor --migrate-config`).

## OXB-101: suíte de regressão com programas REAIS

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - O `.oxe/` da F1 e da F2 do OXESpace congelado como fixture. Antes de cada RC rodam lint, compile, dossiê e close dry-run sobre ele.

## OXB-102: ciência do merge-train

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Lê o estado do PR e os comentários `merge-train:`.
  - Quando o PR de uma tarefa sai do trem: reabre a tarefa, faz merge da main, roda o verify de novo, push e relabel.
  - Nunca faz push num PR na fila no meio do carro. Nunca apaga branch ou tag.

## OXB-103: modo coordenador

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Pelo DAG do PROGRAM, o próximo item de preparação de cada papel (CCRs, testes congelados das próximas fases) vai para um arquivo de fila que os papéis leem.

## OXB-104: artefato SYSTEM-DESIGN

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Gerado por scan/spec: componentes e processos, fluxos técnicos e de negócio, decisões no estilo ADR e diagramas Mermaid (C4 de contexto/container, sequências principais).
  - Cada seção é ligada a ids R/A.

## OXB-105: gate de drift de design no close

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - Quando o diff da fase toca módulos ou fluxos do SYSTEM-DESIGN (ou de `.oxe/codebase/`) e o documento não mudou, o close falha listando as seções desatualizadas.
  - Depois de cada close roda um `compact` automático que grava o CODEBASE-DELTA.

## OXB-106: tipos de tarefa declarativos

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - add, remove, move, test-only e config-only, cada um com a sua regra de pack. A OXB-088 fez só o remove.

## OXB-107: gates como plugins de config

- **Status:** aberto (roteiro de excelência, TECH LEAD em 08/11, a pedido do usuário).
  - command, signoff, deploy e script próprio, sem lógica de gate fixa no código.

# Melhoria contínua (08/11)

Requisitos escritos pelo TECH LEAD, aprovados pelo usuário. O desenho e a implementação são próprios do oxe-build.

## OXB-108: verificador anti-stub no verify da tarefa e da fase

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Para cada símbolo e arquivo criado ou alterado, checa três níveis:
  -   - **existe**;
  -   - **é substantivo**: corpo vazio, "not implemented", retorno só com TODO e componente placeholder são stub;
  -   - **está ligado**: importado e usado a partir de um ponto de entrada alcançável.
  - Uma tarefa verde nos testes congelados, mas reprovada num nível, fica vermelha, com arquivo e linha.

## OXB-109: gate de rigor do teste congelado (no spec freeze e no plan lint)

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - O teste precisa exercitar código real, não asserção sobre o texto-fonte.
  - A exceção é declarada com `rigor: source-assertion` e um motivo.
  - Opcionalmente, uma amostra de mutantes (`--mutation`). O relatório sai por arquivo de teste.

## OXB-110: registro de defeitos abertos entre fases (`.oxe/OPEN-DEFECTS.json`)

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Acumula stubs, TODO/FIXME do diff, testes skip/only, verifies não rodados, CRs de sinal abertos e achados do A70.
  - Bloqueia o close e o gate de deploy, salvo `--waive <id> --reason` registrado.

## OXB-111: revisão adversarial do plano (`plan lint --review`) com PLAN-REVIEW.md

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Dá veredito por dimensão:
  -   - cobertura;
  -   - completude;
  -   - acoplamento temporal não declarado;
  -   - ligações planejadas;
  -   - escopo;
  -   - verificação derivada dos critérios;
  -   - decisões;
  -   - redução de escopo.
  - Um FAIL bloqueia o execute, salvo waiver com motivo.

## OXB-112: decisões como ids de primeira classe (`D-<fase>-<n>`)

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - `oxe-cc decision add`. As tarefas citam as decisões, o verify checa a evidência e o lint aponta decisão sem tarefa.

## OXB-113: monitor de folga de contexto do orquestrador

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Hooks registram o uso de contexto e avisam nos limites.
  - `oxe-cc runtime handoff` grava um estado retomável antes da compactação.

## OXB-114: verificação de UI ao vivo dentro do loop (opt-in por fase)

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Um agente verificador isolado, o único com ferramentas de browser, roda depois de cada onda que toca UI.
  - Os achados viram CRs de sinal na fase.

## OXB-115: alarme de complexidade

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Mede as funções tocadas contra uma linha de base. Passando do limite, gera uma proposta de refatoração (no modo strict, bloqueia o close).

## OXB-116: diff da superfície de API por fase

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - Exports, assinaturas, canais IPC e ferramentas MCP, antes e depois, no dossiê.
  - Mudança fora dos `symbols`/`symbols_removed` do pack é sinalizada.

## OXB-117: lacunas extras

- **Status:** aberto (aprovado pelo usuário em 08/11, "melhoria contínua total"; vem depois do bloco A e antes da OXB-097).
  - (a) custo e tempo por tarefa, CR e retry, com previsão do orçamento da fase;
  - (b) verify instável (verde e depois vermelho na mesma árvore) entra em quarentena com evidência;
  - (c) impacto de regressão entre fases antes do execute;
  - (d) ensaio de rollback (`runtime rollback --dry-run`) antes do close;
  - (e) relatório da fase legível por humanos, em uma página, gerado no close.
