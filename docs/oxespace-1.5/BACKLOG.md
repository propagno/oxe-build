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

- **Status:** resolvido (1.21.2). Aprovado pelo usuário em 08/11 ("melhoria contínua total").
  - `bin/lib/oxe-stub-check.cjs`, em três níveis, para cada arquivo que a tarefa criou ou alterou:
    - **existe:** todo símbolo que a entrada da tarefa no IMPLEMENTATION-PACK declara está definido no arquivo declarado (ESM, CommonJS, class/const/fun/def…).
    - **substantivo:** nenhum stub nas linhas que a tarefa **acrescentou** (o diff contra HEAD; um arquivo novo conta inteiro). Contam "not implemented", `throw new Error('TODO')`, retorno vazio marcado TODO, Kotlin `TODO()`, `NotImplementedError`, `todo!()`, `UnsupportedOperationException("TODO")`, componente placeholder (TODO/Placeholder/Coming soon) e função exportada vazia. TODO antigo e arquivo de teste não contam.
    - **ligado:** um arquivo-fonte novo é importado ou usado por outro arquivo que não é teste, ou é ponto de entrada (package.json, `stub_check.entries`).
  - **Verify da tarefa:** toda tarefa de código ganha, no fim do verify, o segmento `node …/oxe-stub-check.cjs --task Tn` (níveis existe e substantivo).
    - Uma tarefa verde nos testes congelados, mas com stub, fica vermelha. O retry recebe `arquivo:linha [nível] motivo`.
    - O segmento entra no grafo do execute, não no dry-verify do lint, em que o diff ainda está vazio.
  - **Verify da fase:** um gate implícito `stub-check` roda sobre o diff da fase (`base_commit` → árvore). Vermelho vira CR de defeito, como os gates do projeto.
    - O nível **ligado** na fase é opt-in (`stub_check.wired: true`): um módulo que uma fase entrega costuma ser ligado por uma fase seguinte.
  - **Exceções:** um comentário `oxe-stub-ok` na linha (exceção revisada), `stub_check.ignore` (globs), e `stub_check: false` desliga tudo.
  - Teste: `tests/oxe-1212-stub-check.test.cjs` (os três níveis com arquivo:linha; a CLI; no loop do execute, a tarefa com stub fica vermelha, o retry vê a linha e, corrigida, completa).

## OXB-109: gate de rigor do teste congelado (no spec freeze e no plan lint)

- **Status:** resolvido (1.21.2), no `plan lint`. O `spec freeze` ainda não existe (OXB-099) e vai reusar o mesmo módulo (`bin/lib/oxe-test-rigor.cjs`).
  - **Asserção sobre o texto:** o teste congelado de uma tarefa pendente que **lê código-fonte do produto como texto** (`readFileSync` de .ts/.js/.kt…) e **não importa nada do produto** testa o texto, não o comportamento. O lint diz qual arquivo ele lê e como corrigir.
    - Exceção declarada no acceptance_tests: `"rigor": "source-assertion"` com `"rigor_reason"` (≥ 8 caracteres; o schema exige o motivo).
    - Por padrão é aviso, porque as fases em andamento têm testes de remoção que podem ler fonte. `lint.test_rigor: "error"` torna fatal. Testes de tarefas já done não são cobrados.
  - **`plan lint --mutation [--mutation-max N]`:** para os testes congelados das tarefas done, aplica até N mutantes (padrão 3) em cada arquivo do produto que o teste importa: `===`↔`!==`, `true`↔`false`, `<`→`>=`, `>`→`<=` e retorno → `undefined`.
    - Um mutante que o teste ainda passa "sobrevive". O relatório sai por arquivo de teste (mortos/total e os sobreviventes com arquivo:linha) em `test_rigor.mutation` e nos avisos.
    - Roda numa worktree temporária em HEAD, com junction do node_modules desfeito antes da remoção. A árvore real nunca é mutada.
  - Teste: `tests/oxe-1212-test-rigor.test.cjs` (teste de texto sinalizado, teste de comportamento não; exceção; motivo obrigatório em modo error; teste forte mata os mutantes, teste fraco os deixa vivos; árvore intacta e worktree removida).

## OXB-110: registro de defeitos abertos entre fases (`.oxe/OPEN-DEFECTS.json`)

- **Status:** resolvido (1.21.2). `bin/lib/oxe-open-defects.cjs` e o comando `oxe-cc runtime defects`.
  - O registro `.oxe/OPEN-DEFECTS.json` da fase ativa sai do diff dela (`base_commit` → árvore) e do programa. Cada item tem um id estável `OD-<tipo>-<hash>`.
    - stubs nas linhas acrescentadas (OXB-108);
    - TODO/FIXME/XXX/HACK acrescentados em código;
    - testes `.skip`/`.only`/`.todo`, `xit`/`fit`, `@Disabled`/`@Ignore`;
    - tarefas done sem verify;
    - CRs de sinal abertos (`runtime signal`) e CRs abertos nos critérios permanentes (A70).
  - Um item sai quando some da origem. O comentário `oxe-defect-ok` na linha é a exceção pontual.
  - **`runtime program close`:** cada defeito aberto é uma razão de bloqueio, com o comando para dispensá-lo. Como o gate de deploy (`phase_gates` kind deploy) é avaliado no close, ele também fica bloqueado. `--no-defects` desliga.
  - **`runtime defects --waive <id> --by <papel> --reason "…"`:** registra a dispensa, que continua valendo quando o registro é regenerado. Sem `--by` ou com motivo curto, recusa.
  - Teste: `tests/oxe-1212-open-defects.test.cjs` (os cinco tipos com arquivo:linha; o close bloqueado com os ids; dispensas pela CLI que sobrevivem à regeneração; motivo obrigatório).

## OXB-111: revisão adversarial do plano (`plan lint --review`) com PLAN-REVIEW.md

- **Status:** resolvido (1.21.2). `oxe-cc plan lint --review` grava `.oxe/PLAN-REVIEW.md` e `.json` (`bin/lib/oxe-plan-review.cjs`).
  - A revisão é determinística: lê o PLAN.json, os critérios da fase ativa (PROGRAM.json), o pack, as decisões e os testes congelados. Dá um veredito PASS/WARN/FAIL por dimensão:
    - **cobertura:** critério da fase sem tarefa (FAIL) ou sem teste congelado (WARN);
    - **completude:** tarefa sem files ou tarefa de código sem verify (FAIL), tarefa sem critério (WARN);
    - **acoplamento temporal não declarado:** duas tarefas pendentes que mexem no mesmo arquivo sem um caminho de dependência entre elas (FAIL); teste congelado que precisa de arquivo que outra tarefa entrega, sem depender dela (WARN);
    - **ligações planejadas:** arquivo-fonte novo que nenhuma outra tarefa, pack ou teste menciona (WARN);
    - **escopo:** glob de tudo (`**`) (FAIL), mais de 25 arquivos (WARN);
    - **verificação derivada dos critérios:** tarefa cujo verify não roda nenhum dos testes congelados dos critérios dela (FAIL);
    - **decisões:** tarefa que cita decisão inexistente (FAIL), decisão que nenhuma tarefa cita (WARN);
    - **redução de escopo:** critério entregue só por tarefas de verificação ou entrega externa (WARN).
  - Os FAIL viram erros do lint.
  - **O execute é bloqueado** (`plan_review:<dimensão>` no preflight) enquanto a revisão for do plano atual (hash) e tiver FAIL sem dispensa. Revisão de outra versão do plano só gera aviso.
  - **Dispensa:** `plan lint --review --waive <dimensão> --by <papel> --reason "…"`. Fica no PLAN-REVIEW e vale enquanto o plano for o mesmo.
  - Teste: `tests/oxe-1212-plan-review.test.cjs` (cada dimensão no plano ruim; o .md; os FAIL como erros; o bloqueio no preflight; as dispensas pela CLI; o plano alterado vira aviso de revisão antiga; um plano limpo passa em tudo).

## OXB-112: decisões como ids de primeira classe (`D-<fase>-<n>`)

- **Status:** resolvido (1.21.2). `bin/lib/oxe-decisions.cjs` e o comando `oxe-cc decision add|list`.
  - `oxe-cc decision add --title "…" [--text] [--phase Fn] [--by] [--check "<cmd>"] [--criteria A3]`: id `D-<fase>-<n>`, numerado por fase. A fase padrão é a ativa; sem programa, fica `D-<n>`.
    - O registro é append-only em `.oxe/program/decisions.ndjson`, o mesmo arquivo em que os spikes gravam `D-SPIKE-Tn` e que o dossiê já mostra.
  - O `decisions` do PLAN.json aceita `D-<n>`, `D-<fase>-<n>` e `D-SPIKE-Tn`.
  - **Lint:** tarefa que cita decisão inexistente é **erro**. Decisão ativa da fase que nenhuma tarefa cita é aviso.
  - **Verify:** uma decisão com `--check` vira gate implícito `decision-<id>` no verify da fase (citada por alguma tarefa, ou da fase). Vermelho reprova o verify e abre CR de defeito, como os gates do projeto.
  - A revisão do plano (OXB-111) também julga as decisões.
  - Teste: `tests/oxe-1212-decisions.test.cjs` (ids por fase pela CLI; o erro de decisão inexistente e o aviso de decisão não citada; o check vira gate da fase).

## OXB-113: monitor de folga de contexto do orquestrador

- **Status:** resolvido (1.21.2). `bin/lib/oxe-handoff.cjs`.
  - **`oxe-cc runtime handoff [--note "…"]`:** grava `.oxe/HANDOFF.md` e `.json`, um estado retomável que dispensa reler a conversa:
    - fase, branch e HEAD;
    - arquivos sujos fora de `.oxe/`;
    - run;
    - tarefas done, pendentes e externas;
    - checkpoints falhos com o tipo;
    - CRs e defeitos abertos;
    - o próximo comando.
  - **`oxe-cc runtime context --used <tokens> --limit <tokens>`:** é para o hook do host (por exemplo PreCompact ou um hook por turno), que manda o uso de contexto do orquestrador.
    - Registra o evento `ContextUsage` e classifica: ok, `warn` a partir de 70% ("termine a tarefa atual e rode o handoff") e `critical` a partir de 85%, quando grava o handoff sozinho (`reason: context_critical`).
    - Os limiares mudam com `context.warn` / `context.critical` no `.oxe/config.json`.
  - Hook do Claude Code, em `.claude/settings.json`: `{ "hooks": { "PreCompact": [{ "hooks": [{ "type": "command", "command": "npx oxe-cc runtime handoff --reason precompact" }] }] } }`.
  - Teste: `tests/oxe-1212-handoff.test.cjs` (o handoff com as tarefas, o checkpoint falho, o arquivo sujo e o próximo passo; os três níveis de contexto, com o handoff automático no crítico; os limiares configuráveis).

## OXB-114: verificação de UI ao vivo dentro do loop (opt-in por fase)

- **Status:** resolvido (1.21.2). `bin/lib/oxe-ui-verify.cjs`. É opt-in por fase.
  - `PLAN.json` (o plano da fase): `"ui_verify": { "command": "<verificador>", "report"?: ".oxe/ui-verify/report.json", "timeout_ms"?: 900000 }`. Também vale `config.json ui_verify` com `phases: ["F3"]`.
  - **Quando roda:** o execute detecta o fim de cada **onda** pelo grafo (todas as tarefas da onda terminaram). Se alguma tarefa de UI (tsx, jsx, vue, svelte, css, html…) completou nela, ele roda o verificador.
    - O verificador é um agente isolado, o único com ferramentas de browser, escolhido pelo projeto: um CLI de agente só com o MCP de browser, ou um script Playwright.
    - Ele recebe `OXE_UI_WAVE`, `OXE_UI_TASKS`, `OXE_UI_FILES`, `OXE_UI_PHASE` e `OXE_UI_REPORT`, e grava o relatório no formato de sinal: `{ phase, findings: [{ id, summary, class?, criteria?, files? }] }`.
  - **Achados:** cada um vira **CR de sinal** da fase pelo `runtime signal` (`by: signal:ui_verify`, sem duplicar pelo id). O evento `UiVerifyCompleted` traz a onda, as tarefas, o código de saída, o relatório e os CRs criados. Sem relatório, o evento diz isso com o final da saída.
  - Teste: `tests/oxe-1212-ui-verify.test.cjs` (só a onda com tarefa de UI chama o verificador; o achado vira CR de sinal da F1; sem `ui_verify` nada roda).

## OXB-115: alarme de complexidade

- **Status:** resolvido (1.21.2). `bin/lib/oxe-complexity.cjs` e o comando `oxe-cc runtime complexity`.
  - Para as funções que a fase tocou (JS/TS, Kotlin/Java, fora de testes), conta os pontos de decisão (1 + if/for/while/case/catch/&&/||/??/ternário, ignorando strings e comentários) na árvore e na base da fase.
  - Uma função **acima do limite** (`complexity.max`, padrão 15) que é **nova** ou **cresceu** ≥ `complexity.max_growth` (padrão 5) gera uma proposta de refatoração em `.oxe/REFACTOR-PROPOSALS.md` (arquivo:linha, antes → depois e o que fazer). Sai também o evento `ComplexityAlarm`.
  - **Modo strict** (`profile: "strict"` ou `complexity.block: true`): os alarmes bloqueiam o `program close`. Fora dele, ficam só como proposta.
  - Teste: `tests/oxe-1212-complexity-api.test.cjs` (função que cresceu e função nova acima do limite; a proposta; o bloqueio no strict; palavras-chave em strings e comentários não contam).

## OXB-116: diff da superfície de API por fase

- **Status:** resolvido (1.21.2). `bin/lib/oxe-api-surface.cjs`, ligado ao `runtime dossier`.
  - A superfície de API dos arquivos que a fase mudou, na base e na árvore:
    - exports ESM e CommonJS, com assinatura (parâmetros e tipo de retorno);
    - classes, interfaces, types e enums exportados;
    - canais IPC (`ipcMain`/`ipcRenderer` handle/on/invoke/send);
    - ferramentas MCP (`registerTool` / `server.tool` / `name` com `inputSchema`).
  - O dossiê da fase ganha `api-surface.md`, com o que foi adicionado, removido e teve a assinatura mudada. O resultado do `runtime dossier` traz `api_surface`.
  - **Sinalizado:** export adicionado, removido ou mudado que não está nos `symbols` / `symbols_removed` do pack. Com `api_surface.block: true` no config, vira issue do dossiê e bloqueia o close.
  - Teste: `tests/oxe-1212-complexity-api.test.cjs` (export novo, removido e com assinatura mudada; canal IPC trocado; ferramenta MCP; exports fora do pack sinalizados).

## OXB-117: lacunas extras

- **Status:** resolvido (1.21.2). `bin/lib/oxe-phase-extras.cjs`.
  - **(a) Custo e tempo:** `oxe-cc runtime cost` lê o `ExecutorUsage` e mostra custo, turnos e tempo por tarefa (separando o gasto dos retries), por CR (as tarefas ligadas a ele) e o total.
    - Traz uma **previsão** do orçamento da fase: custo médio das tarefas done × tarefas pendentes, e tempo restante.
  - **(b) Quarentena:** um verify `flaky_suspect` (OXB-162: verde, vermelho e verde de novo na mesma árvore) entra em `.oxe/QUARANTINE.json` com a evidência e a contagem. O `plan lint` avisa quais tarefas pendentes ainda usam esse comando.
  - **(c) Impacto de regressão entre fases:** o preflight do execute avisa (`regression_impact:Tn`) quando uma tarefa pendente mexe em arquivo que a regressão congelada de uma fase fechada exercita, seja o teste ou o que ele importa.
  - **(d) Ensaio de rollback:** o `program close` reverte os commits da fase (`base_commit..HEAD`) numa worktree temporária. Se não reverte limpo, bloqueia o close; `--no-rollback-check` registra o risco e segue. A árvore real não é tocada.
  - **(e) Relatório da fase:** o close grava `RELATORIO.md`, de uma página, no dossiê da fase, com:
    - critérios entregues, tarefas e taxa de 1ª tentativa;
    - custo e tempo;
    - CRs;
    - riscos que ficaram (defeitos dispensados, alarmes de complexidade, API fora do pack, sign-offs adiados, verifies em quarentena);
    - o ensaio de rollback.
  - Teste: `tests/oxe-1212-phase-extras.test.cjs`.

# Backlogs de comparação (08/11)

Itens P0 e P1 revisados pelo TECH LEAD. O desenho é próprio do oxe-build.

## OXB-118: dizer quais regras do projeto são aplicadas, e regras de ação estruturadas

- **Status:** resolvido (1.21.2), P0. Antes, as 10 `policy_rules` do OXESpace eram strings, e o `checkPolicyRules` descartava em silêncio toda regra sem `id`+`forbid`: nenhuma era aplicada.
  - Toda regra agora tem estado: **aplicada** (forma estruturada com checagem) ou **só texto**.
  - O `doctor` mostra "Regras do projeto: N aplicada(s), M só texto" e lista as que são só texto. O `plan lint` avisa com `policy_rule_advisory` e uma dica de conversão, e uma regex inválida é erro do lint. `oxe-cc policy list [--json]` lista tudo.
  - **Regras de ação:**
    - `{ id, kind: "command", deny: "<regex>" }` vale para os comandos que o executor rodou;
    - `{ id, kind: "path", deny_read|deny_write: "<glob>" }` vale para os caminhos que ele leu ou escreveu;
    - `{ id, kind: "env", strip: "<PREFIXO>" }` tira o prefixo do ambiente de **todo** processo filho.
    - O executor do runtime passou a registrar, por tentativa, os comandos, as leituras e as escritas (`ExecutorUsage.commands/reads/writes`, com limite de tamanho).
  - O verify checa as regras de ação contra o que a run registrou. Uma violação vira CR `constraint` (`by: policy_rule:<id>`) com a regra e o comando ou caminho, um por regra+ação, sem duplicar.
  - As regras de conteúdo (`{ id, forbid, paths }`) continuam como antes.
  - Teste: `tests/oxe-1212-policy-rules.test.cjs`.

## OXB-147: o dry-verify rodou um `npm ci` e apagou o node_modules

- **Status:** resolvido (1.21.2). Achado da F2 em 08/11: entre 12:29 e ~13:58 o `node_modules` do oxespace-150 perdeu o vitest e ficou com 557 diretórios.
  - **Causa:** o verify da T18 tinha, como "comandos", três linhas de evidência de CI escritas em prosa, uma delas `npm ci --ignore-scripts (on CI: …)`. O dry-verify roda todo verify da tarefa, então rodou um `npm ci` de verdade, que apaga o `node_modules` antes de instalar. Com o resto da frase como argumento, a instalação não terminou.
  - Nenhum caminho do oxe-build roda npm nem mexe no `node_modules`. A limpeza das worktrees paralelas foi descartada: nenhuma rodou nessa janela.
  - **(a) Comando destrutivo ou em prosa no verify:**
    - é erro estrutural do `plan lint`, com a mensagem `Tn: comando de verify em prosa ou destrutivo: <cmd> — <motivo>`, e por isso o dry-verify nem começa;
    - é bloqueio do preflight do execute (`unsafe_verify:`);
    - o próprio dry-verify nunca executa o segmento (veredito `unsafe_command`/`not_a_command`).
    - Destrutivo: npm ci/install/uninstall/prune/rebuild/update, pnpm/yarn install|add|remove, `rm -rf node_modules`, rimraf, e git stash/checkout/switch/reset --hard/clean/pull/push/commit/tag.
  - **(b)** O `node_modules` é comparado com o package-lock (só os pacotes obrigatórios) no início do dry-verify e a cada troca de onda, também entre os grupos paralelos. Uma árvore quebrada para a rodada com um motivo só ("N pacote(s) ausente(s) … rode npm install"), em vez de centenas de vermelhos enganosos.
  - **(c)** O `runtime sync` detecta package.json ou lockfile vindos no merge:
    - com `sync_deps: "install"`, roda uma instalação que não apaga nada (`npm install`/`pnpm install`/`yarn install`, nunca `npm ci`) mais o `post_install`;
    - no padrão `"stop"`, não roda o re-verify sobre a árvore velha e sai com erro "dependências mudaram: rode npm install && <post_install> … e depois oxe-cc runtime verify".
  - Teste: `tests/oxe-1212-unsafe-verify.test.cjs`.

## OXB-149: preparar o `.oxe/` de uma worktree de fase paralela (F4 junto com a F2)

- **Status:** resolvido (1.21.2). Pedido do TECH LEAD em 08/11, no primeiro uso real da OXB-033.
  - Copiar o PROGRAM.json levava junto a fase ativa (F2), e `program start --phase F4` recusava. Não havia comando suportado para isso.
  - `oxe-cc runtime program init --from <worktree do programa> [--phase Fn] [--base <ref>] [--strict-delivery] [--force]`, rodado na worktree NOVA.
  - **Copia:** SPEC e ROADMAP (a não ser que `spec_ref`/`roadmap_ref` apontem para arquivo versionado), config, PROGRAM.json **sem fase ativa** (com `forked_from`), changes/signoffs/decisions, e a regressão, as interfaces e o dossiê (handoff) das fases fechadas.
  - **Nunca copia:** PLAN, pack, runs, eventos, caches e workspaces. Cada um é por worktree.
  - Com `--phase`, as dependências da fase precisam estar fechadas na origem, e a fase não pode estar ativa lá. A **entrega** de cada dependência na base é conferida do jeito do promote:
    - cada commit próprio da fase (first-parent, sem merge, base_commit..closed_commit) é procurado na base como ancestral, pelo trailer `cherry picked from commit <sha>` ou como patch equivalente;
    - os imports de testes congelados (`parked_tests`, padrão `tests/acceptance/**`) não contam, porque o main recebe a versão do PR.
    - O relatório lista o que não tem equivalente.
    - Ele não bloqueia por padrão: commits que chegaram por outro PR, com outro patch, não são rastreáveis, e a rede de segurança é a regressão congelada da dependência, que roda no verify da fase nova. `--strict-delivery` bloqueia.
    - Smoke no oxespace-150 (F1, origin/main): 19 commits de código, 7 com equivalente, 12 sem e 21 imports de teste ignorados.
  - Depois, a fase é iniciada na worktree nova. O `program adopt` agora também traz o dossiê da fase adotada.
  - Teste: `tests/oxe-1212-program-fork.test.cjs`.

## OXB-148: o adaptador do `claude -p` descartava o motivo da falha

- **Status:** defeito 1 resolvido (1.21.2). Bloqueio da F2 em 08/11: a run oxe-run-mw83vtdy-8uzesq teve a T1 falhando 3 de 3 vezes como `env`, com a mensagem `claude exit 1: ` e o stderr vazio. As 24 tarefas seguintes ficaram bloqueadas.
  - **Causa da opacidade:** com saída não zero, o adaptador olhava só o stderr. O `claude -p --output-format json` põe o motivo no STDOUT (`is_error`, `subtype`, `result`), inclusive com exit 1.
  - **Agora:** o erro carrega `claude exit N · subtype=… · result=… · stdout=…/stderr=… · prompt=N chars (~tokens) · kind=…` e o custo já gasto, que entra no uso da tentativa.
  - **Classificação:**
    - prompt grande demais vira `context`;
    - limite de uso, cota ou rate limit vira `quota`;
    - `error_max_turns` vira `llm`;
    - o resto continua `env`.
    - O scheduler não repete às cegas uma tentativa `context` ou `quota`, porque falharia igual.
  - **Defeito 2, resolvido (rc.19).** A rc.18 revelou o motivo real: `Prompt is too long · ~1368020 tokens (limit 1000000) · prompt=2289577 chars`.
    - O prompt da 1ª chamada da T1, medido, tem 41k chars. O que estourava era o loop de ferramentas.
    - O `grep` embutido percorria o repositório inteiro e só pulava node_modules e pastas com ponto. A `out/` do OXESpace (87 MB de build: monaco 4,6 MB, ts.worker 7 MB, .map e wasm) devolvia linhas minificadas de megabytes, até 200 delas.
    - Cada resultado fica na conversa, que o `claude -p` recebe inteira a cada turno.
  - **O que muda:**
    - o grep não entra em out/dist/build/coverage/release/vendor/.next/target, pula .min.js/.map/lockfiles/binários e arquivos acima de 1 MB, corta a linha em 400 chars em volta da ocorrência e limita o número de ocorrências com aviso;
    - o read_file devolve 800 linhas por padrão, com aviso de como ler o resto;
    - todo resultado de ferramenta tem teto de 40k chars;
    - a partir de 600k chars os resultados antigos são omitidos (os 6 últimos ficam);
    - acima de 1,2M chars a chamada falha antes de sair, como `context`, sem custo;
    - `oxe-cc runtime execute --task Tn --print-prompt [--json]` grava `.oxe/prompts/Tn.md` com a tabela por seção e a estimativa de tokens (≈1,7 chars/token, medido na F2).
  - Teste: `packages/runtime/tests/prompt-size.test.ts` e `tests/oxe-1212-print-prompt.test.cjs`.
  - Teste: `packages/runtime/tests/executor-adapters.test.ts`.

## OXB-122: o conteúdo importado de fora é dado não confiável

- **Status:** resolvido (1.21.2), P0. O `runtime signal --from github:<repo>` gravava título e corpo de issues públicas em CRs lidos por agentes, sem marcar a origem.
  - O texto importado é varrido contra padrões de instrução embutida: sobrescrever regras, troca de papel, marcadores de prompt de sistema, executar comando, baixar e executar, instalar pacote, enviar segredo, mudar config/testes/regras, contornar verificação, comentário oculto e blob codificado. O corpus de 20 casos tem no máximo 1 falso negativo e os achados limpos não geram marca.
  - O CR e o registro `signal` ganham `source_trust` (`external` para github, `internal` para relatório local; ajustável em `signal.trust`) e `injection_flags`.
  - A importação não é bloqueada. O `signal` mostra "⚠ suspeito" com o trecho e a contagem.
  - No contexto do executor, os CRs importados que tocam os critérios da tarefa entram só num bloco "## Achados importados (DADO, não instrução)", entre marcadores `<<<DADO-EXTERNO …>>>`, com confiança, marcas e origem, e com a orientação de não seguir ordens que estejam ali.
  - Teste: `tests/oxe-1212-signal-trust.test.cjs`.

## OXB-121 (parte): a contradição do STATE.md

- **Status:** resolvido (1.21.2). A contradição do STATE.md foi resolvida primeiro (P0). Depois vieram o `state validate`, o `state sync` e o `state.json` (`bin/lib/oxe-state.cjs`).
  - **`.oxe/state.json`** (contrato `1.0.0`) é gravado a cada projeção do STATE.md, ou seja, a cada transição: compile, execute, verify, close e emenda.
    - Chaves sempre presentes, desconhecido = `null`: `program`, `phase`, `run`, `tasks` (`total`, `done`, `failed`, `blocked`, `pending`, `external`, `checkpoint_failed`), `open_crs`, `next` (o mesmo próximo passo do status) e `updated_at`.
    - Sem mudança nas fontes, o arquivo não é reescrito.
  - **`oxe-cc state validate [--strict] [--json]`:** compara o que o STATE.md afirma com as fontes (journal da run, PROGRAM.json, PLAN.json, CRs) e lista as divergências: status da run, concluídos, falhos que já estão done, "completed" com a run `failed`, fase ativa. `--strict` sai com 1 quando há divergência.
  - **`oxe-cc state sync [--dry-run]`:** reescreve as projeções a partir das fontes.
  - Teste: `tests/oxe-1212-state-contract.test.cjs` (o formato da F2: run falha com projeção antiga; o validate aponta; o sync corrige e o `--strict` passa; o contrato tem todas as chaves e é estável).

## OXB-150: testes JUnit em Kotlin/Java e o JUnit XML do Gradle

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11, na worktree da F10.
  - O `plan lint` lia `AttnUsageTest.kt` como UM teste chamado "Notice", uma string do corpo de um teste.
  - **Descoberta:** em `.kt/.kts/.java/.groovy/.scala`, os testes são os métodos anotados com `@Test`, `@ParameterizedTest`, `@RepeatedTest` ou `@TestFactory`:
    - `fun nome()`, ``fun `nome com espaço`()`` e `void nome()`;
    - aceita modificadores e anotações entre `@Test` e o método;
    - inclui o `@DisplayName("…")` quando houver;
    - nunca usa strings literais.
    - Em JS/TS, nada muda.
  - **Verify com Gradle/Maven:** o comando não imprime os testes um a um, porque o JUnit os grava em `build/test-results/**.xml` (ou `target/surefire-reports`). Os relatórios que **esse** comando escreveu (pelo mtime) são anexados à saída. A contagem e o `proves` passam a ver cada teste, e o `proof_not_executed` lista os que passaram.
  - Teste: `tests/oxe-1212-jvm-tests.test.cjs` e `packages/runtime/tests/junit-files.test.ts`. A descoberta foi conferida no arquivo real da F10: 3 testes.

## OXB-151: promover tarefa enquanto o execute roda no mesmo tree

- **Status:** resolvido (1.21.2). Pergunta do TECH LEAD em 08/11, com a F2 executando: cada tarefa pronta deve entrar no trem de merge na hora, sem esperar as 25.
  - **Antes era inseguro:** o `runtime promote` fazia `git checkout -b` no próprio tree do programa, cherry-pick e `pr:ready` ali, e voltava. Com um execute rodando, os arquivos trocavam por baixo do executor.
  - **Agora, por padrão,** o promote monta a branch numa **worktree temporária** a partir da base (`.oxe/promote-ws/…`): faz o cherry-pick -x, roda o `pr:ready` com o node_modules por junção (o do programa ou `deps_link_from`, nunca uma instalação), e então o push e o PR.
  - A worktree é removida com segurança: os links são desfeitos antes, e nunca há `remove --force` atravessando junção.
  - O checkout, o índice, o trabalho não commitado e o node_modules do programa não são tocados, e o tree sujo deixa de ser motivo de recusa. `--in-place` mantém o comportamento antigo.
  - `runtime execute --promote-each [--base main]` dispara, a cada tarefa concluída verde, um `runtime promote Tn --open-pr` em segundo plano. Cada um usa sua própria worktree, o log vai para `.oxe/promote/Tn.log` e fica o evento `TaskPromoteQueued`, depois `TaskPromoted` com o link do PR.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs` (tree do programa sujo e com arquivo no índice continua idêntico, e o node_modules real sobrevive).

## OXB-152: launchers POSIX no Windows e mensagem de erro legível

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F10): `./mobile/android/gradlew …` deu `broken_command` no Windows ("'.' não é reconhecido…"), e a mensagem chegou corrompida ("n�o").
  - No win32, o verify (runtime), o dry-verify e o executor paralelo mapeiam `./<caminho>/gradlew` para `<caminho>\gradlew.bat` e `mvnw` para `mvnw.cmd`, em cada segmento.
  - Um `./script.sh` sem `.cmd`/`.bat` irmão gera aviso no lint.
  - A saída do console é decodificada como UTF-8 quando é válida; senão, como cp850, a code page OEM em que o cmd escreve as próprias mensagens. O `chcp 65001` não resolveu: o cmd mantém a OEM em pipe.
  - Teste: `tests/oxe-1212-win-launchers.test.cjs`.

## OXB-153: o timeout de 5 min por chamada do `claude -p` era fixo e recomeçava a tarefa

- **Status:** resolvido (1.21.2), bloqueio da F4. Na run oxe-run-mw855cc1-yap7sx, a T1 (F4-P1: lugares + migração 095) falhou na 1ª tentativa depois de 9 turnos e 54 chamadas de ferramenta, US$ 5,84, com `claude -p excedeu 300000 ms` classificado como `env`. A 2ª tentativa recomeçou do zero.
  - O `DEFAULT_TIMEOUT_MS` do adaptador era 5 min, e nem o config nem a CLI o alcançavam.
  - **(a)** `--llm-timeout-ms` no execute, `executor.timeout_ms` no config, padrão de 20 min. Vale para o adaptador `claude` e para o `http`.
  - **(b)** O timeout de uma chamada vira a classe `timeout`, e a **mesma tentativa continua**: os arquivos já escritos ficam, e a conversa segue com uma mensagem pedindo para continuar em passos menores (até 2 timeouts seguidos). Só depois disso a tentativa falha como `timeout`, não `env`.
  - **(c)** Um turno longo mostra o tempo decorrido a cada minuto (`[turno N: X min]`), e o timeout aparece como `⏱ … continuando a mesma tentativa`. O evento `turn_complete` traz `elapsed_ms`.
  - Teste: `packages/runtime/tests/executor-adapters.test.ts`.

## OXB-154: teste congelado que falha na compilação, e o acoplamento de compilação entre tarefas

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F10, Kotlin/gradle), com um adendo quando o esqueleto da API já compilava.
  - **No dry-verify, o vermelho certo de linguagem compilada:**
    - erro de compilação em símbolo ainda não criado vira `missing_target`, mas só quando **todos** os símbolos citados estão nos `symbols` do pack da tarefa (Kotlin `Unresolved reference`, Java `cannot find symbol … symbol: method x`, tsc `has no exported member` / `Cannot find name` / `Property … does not exist`);
    - stub que executa vira `missing_target`: `kotlin.NotImplementedError` / "An operation is not implemented", `UnsupportedOperationException` com TODO e "not implemented yet";
    - falha de asserção JUnit num arquivo de teste que a tarefa **prova** vira `assertion_red` (`AssertionFailedError`, `AssertionError`, `ComparisonFailure`, kotlin.test, `expected: <…>`). O JUnit XML que o gradle/maven gravou é lido também no dry-verify, como no verify desde a OXB-150.
  - Continuam `broken_command`: erro de configuração do gradle (task inexistente, dependência ou plugin não resolvido), erro de compilação em símbolo fora do pack e asserção em teste que a tarefa não prova.
  - **Acoplamento:** o lint avisa quando várias tarefas pendentes compilam juntas no mesmo comando de projeto inteiro (gradle/maven/tsc sem arquivo). Os testes congelados de uma não compilam enquanto faltarem os símbolos das outras, e a dica é commitar antes um esqueleto com TODO.
  - Ainda não feito: o gerador `plan skeleton`. Sem as assinaturas no pack, um stub gerado não compila contra os testes.
  - Teste: `tests/oxe-1212-compiled-right-red.test.cjs`.

## OXB-155: o verify por tarefa do execute ignorava `verify_timeout_ms` (60 s fixos)

- **Status:** resolvido (1.21.2), bloqueio da F2. Na run oxe-run-mw83vtdy-8uzesq, a T2 (G7) falhou duas vezes no segmento 2/5 `npm run typecheck` com timeout de 60 s, mesmo com `verify_timeout_ms: 900000` no config. Depois veio o `VerifyCommandSuspect identical_verify_failure` e a tarefa ficou bloqueada.
  - A OXB-072 tinha corrigido só o `runtime verify`; o execute não passava o timeout ao scheduler.
  - Agora o execute passa `--verify-timeout-ms` > `verify_timeout_ms` do config > 10 min para o verify de cada tarefa.
  - Um verify que estoura o tempo **não** conta como `identical_verify_failure` (quem falhou foi o relógio, não o código), então não consome o ciclo de correção.
  - Teste: `tests/oxe-1212-exec-verify-timeout.test.cjs`.

## OXB-156: o PR de uma tarefa levava todos os commits do programa

- **Status:** resolvido (1.21.2), bloqueio da F2. `runtime promote T1 --base main` deu `conflito no cherry-pick de 3f0ee63e (tests/acceptance/parked-f3/…)`. O branch do programa tinha 50 commits além do main (close da F1, imports de testes congelados, syncs), e o promote juntava os que tocavam os arquivos de teste da tarefa: os imports levavam junto testes de outras tarefas e estacionados.
  - O PR agora leva exatamente:
    - (a) os commits **da tarefa** (trailer `OXE-Task` ou `done_commit`), por cherry-pick -x;
    - (b) os testes congelados que ela prova (as entradas de `acceptance_tests` com `task` igual, ou com os critérios dela quando a entrada não diz a tarefa), mais as fixtures locais que eles importam, **como arquivos** do tip do programa, num commit `test(acceptance): frozen tests of Tn`. Os iguais na base são pulados.
    - Nada além disso: testes de outras tarefas e estacionados, `.oxe/` e commits de outras fases ficam fora.
  - O corpo do PR lista as duas partes. Vale também para o `--promote-each`.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs`, com um commit de import que conflitaria e agora fica fora.

## OXB-157: `--base main` do promote usava o main LOCAL

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11.
  - O que aconteceu: `runtime promote T1 --base main --open-pr` deu conflito de cherry-pick em arquivos iguais entre o pai da T1 e o origin/main.
  - A causa: `main` resolveu para a branch local (061c12cc, de 28/10), não para o origin/main (f1d2c7ff).
  - `--base <nome>` agora vira `<remote>/<nome>`, depois de um fetch dessa ref. Uma ref remota ou um sha é usado como veio.
  - Sem `--base`, a base é a branch padrão do remoto (`refs/remotes/origin/HEAD`). O `--promote-each` segue a mesma regra.
  - A saída mostra a base resolvida com o sha (`a partir de origin/main @ <sha>`) e avisa quando a branch local de mesmo nome está atrás do remoto.
  - O `gh pr create --base` recebe o nome da branch no remoto (`main`), nunca `origin/main`.
  - O `status` avisa quando uma tarefa foi concluída na run mas não está `done` no PLAN.json (PLAN.json regenerado): "T1 concluída(s) na run mas não no PLAN.json … oxe-cc plan done T1".
  - Teste: `tests/oxe-1212-sync-promote.test.cjs` e `tests/oxe-1212-state-coherent.test.cjs`.

## OXB-158: o promote rodava o pr:ready antes do push e não abria o PR

- **Status:** resolvido (1.21.2). Visto no `--promote-each` da F2-T2: o pr:ready passou nos checks mas não conseguiu postar o status no GitHub ("aba53690 is not on GitHub yet: push it first") e saiu com erro. O promote tratou isso como `pr:ready vermelho` e não abriu o PR.
  - Com `--open-pr`, a branch agora é publicada **antes** do pr:ready, que posta o status no sha publicado. Depois vem o PR.
  - Quando só o post do status falha (e, tirando essas linhas e as linhas do próprio npm, nada mais reporta falha), o resultado é `pr_ready.ok` com `status_post_failed`, e o PR abre. Quando um check reprova, o PR não abre, e a mensagem avisa que a branch já está no remoto.
  - Teste: `tests/oxe-1212-sync-promote.test.cjs` (pr:ready que só passa com a branch no remoto; falha só de status; falha de check).

## OXB-159: id de CR que colide entre worktrees e rascunho do executor na raiz

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (oxespace-150-f4, rc.23).
  - **CR-35 duplicado:** o `runtime feedback` na worktree da F4 registrou "CR-35 (spec_gap) na fase F4", e o tronco já tinha o CR-35 da F7. As duas worktrees numeravam a partir da mesma cópia do `changes.ndjson`.
    - Numa worktree criada por `program init --from`, o id agora vem com a fase: `CR-F4-1`. O tronco continua com `CR-NN`. `program.cr_id_prefix` força um prefixo. O cálculo do próximo número só lê ids do mesmo formato (antes, `CR-F4-3` seria lido como 43).
    - `program adopt` traz os registros de CR da worktree adotada: CRs, mudanças de status e sinais. O que já existe aqui (a cópia do fork ou um merge anterior) é ignorado, e adotar de novo não duplica nada.
    - Se o id já está em uso aqui por **outro** CR (o caso da rc.23), o CR é renomeado para `CR-<fase>-n` e guarda `origin_id`. Os status dele seguem a renomeação, e o `resolves` da regressão, as interfaces e o dossiê da fase adotada são reescritos. A saída lista `CR-35 -> CR-F4-1`.
    - `resolves` no PLAN.json e o `feedback resolve|withdraw` aceitam `CR-<fase>-n`.
  - **Rascunho na raiz:** as tentativas da F4-T1 gravaram `a13-filtered.log`, `a13-out.log` e `tsconfig.tsbuildinfo` na raiz do repositório, o que virou ScopeViolation.
    - Cada tarefa tem `.oxe/tmp/<tarefa>/`, que o git ignora (um `.gitignore` próprio) e que é apagada quando a tarefa passa. O prompt da tarefa cita esse caminho.
    - `*.log` e `*.tsbuildinfo` na raiz (configurável por `executor.scratch_ignore`) não contam como violação. O evento é `ScratchIgnored`. Os arquivos que a tentativa criou (novos e não versionados) são removidos. Os que já existiam ou estavam sujos antes da tarefa não são tocados.
  - Teste: `tests/oxe-1212-cr-ids-scratch.test.cjs`.

## OXB-160: promote com EISDIR ao copiar "fixtures", e a branch local que um promote anterior deixou

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: `runtime promote T3 --open-pr` (rc.24, oxespace-150) falhou com `EISDIR: illegal operation on a directory, read`.
  - O teste congelado da T3 importa `../../../shared/types/ipc`, que é um diretório (`index.ts`). O copiador de fixtures da OXB-156 aceitava qualquer caminho que existisse no git (inclusive uma árvore) e seguia imports de módulos do produto.
    - Agora só copia o que resolve **dentro da árvore dos testes** (até a pasta `tests`/`test`/`__tests__`/`spec`/`e2e` do arquivo).
    - A resolução segue node/TS: o arquivo, depois as extensões, depois `.js`→`.ts`, depois `dir/index.*`. Só aceita um blob: um diretório nunca é lido, e código do produto nunca é copiado do tip do programa.
  - **Branch que sobrou:** uma `oxe/promote-t3` deixada por um promote que falhou (local e nunca publicada) fazia o próximo promote recusar.
    - O promote agora recria a própria branch quando ela não está no remoto, não tem upstream, não está em uso numa worktree **e** foi criada pelo promote: marca `branch.<b>.oxePromote`, ou todos os commits depois da base são cherry-picks `-x` ou o commit dos testes congelados.
    - Qualquer outra branch com o mesmo nome continua recusada e não é tocada.
  - Teste: `tests/oxe-1212-promote-fixtures.test.cjs`.

## OXB-161: promote ciente das dependências (PRs empilhados)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: `runtime promote T3 --open-pr` (rc.25) montou `oxe/promote-t3` sobre `origin/main`, e o typecheck do pr:ready reprovou. A T3 importa `writePrivateJson`, que a T1 cria, e o PR da T1 (#720) ainda não tinha sido mergeado. Numa cadeia estrita, toda tarefa depois da primeira falhava assim.
  - Para cada tarefa em `depends_on`, o promote lê o último `TaskPromoted` (branch e PR) e verifica se ele já está na base. Usa o `gh pr view --json state` (MERGED) e, sem gh, o git: a branch é ancestral da base, ou o `git cherry` acha todos os commits dela lá (squash/cherry-pick).
  - Uma dependência promovida e **não mergeada** faz a branch nascer em cima da branch de promote dela. O PR continua contra a base (`gh pr create --base main`) e traz os commits da dependência até ela entrar. O trem mergeia a T1 primeiro, e o diff da T3 encolhe para os commits dela.
  - `stacked_on` (tarefa, branch, PR e sha) vai no resultado, no evento `TaskPromoted` e no corpo do PR, que avisa para mergear a dependência antes.
  - Com várias dependências não mergeadas, a escolhida é a branch que já contém as outras. Sem uma assim, fica a promovida por último, com aviso das que ficaram de fora.
  - Dependência mergeada: a branch sai da base, como antes. Dependência nunca promovida: aviso, e a branch sai da base. Promote da dependência ainda rodando (`--promote-each`): espera até 30 min.
  - `--hold-deps` (também no `execute --promote-each`) espera o merge em vez de empilhar. Emite `TaskPromoteHeld`, refaz o fetch da base a cada minuto e desiste depois de 6 h, com o PR nomeado.
  - Com o pr:ready vermelho, a mensagem e os comandos impressos mantêm `--base main`, nunca a branch da dependência.
  - Teste: `tests/oxe-1212-promote-stacked.test.cjs`.

## OXB-162: a suíte repetia os arquivos do verify, falhava, e a cauda da saída escondia o erro

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F4-T1, run oxe-run-mw855cc1-yap7sx, rc.24, tentativa 3, US$ 5,29).
  - O que aconteceu: o segmento 2/4 rodou quatro arquivos vitest e passou. O segmento 4/4 (`task_suite_command` com `affected_suites`) rodou os mesmos quatro arquivos e falhou, e a tarefa foi bloqueada. A cauda da saída tinha só os avisos "LF will be replaced by CRLF" do git.
  - O segmento da suíte não repete as `affected_suites` que o verify da própria tarefa já roda. Se todas já rodam, o segmento não existe.
  - Um segmento que falha sobre o mesmo comando, ou sobre arquivos de teste que um segmento anterior **da mesma tentativa** passou, roda de novo uma vez e é marcado `flaky_suspect` (evento `VerifyCommandSuspect` com `reason: flaky_suspect`, e a marca no log da tentativa). Se passar, a tarefa segue. Se falhar de novo, a tarefa falha como antes.
  - A cauda da saída descarta as linhas de fim de linha do git. Quando o resumo empurra o bloco do teste que falhou para fora da cauda, o último bloco (FAIL/×/not ok/AssertionError) entra antes dela.
  - Teste: `packages/runtime/tests/verify-flaky.test.ts` e `tests/oxe-1212-task-gates.test.cjs`.

## OXB-163: a worktree nova sem a config local da máquina (local.properties)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: o dry-verify da F10 reprovou todo `:app:testDebugUnitTest` com "SDK location not found … local.properties", porque a worktree nova não tem o `mobile/android/local.properties` (gitignored) com o `sdk.dir`.
  - Arquivos listados em `worktree.copy_local` são copiados pelo `program init --from`, pela worktree temporária do `promote` e pelas worktrees do `--parallel-mutating`.
    - Por padrão nada é copiado, porque um arquivo local pode ter segredos. Só vai o que o projeto lista.
    - Um arquivo versionado ou que já existe no destino nunca é sobrescrito.
  - No dry-verify, "SDK location not found", `ANDROID_HOME`, `ANDROID_SDK_ROOT` e `sdk.dir` viram o veredito `environment` (erro de ambiente, com a dica de `copy_local` ou `ANDROID_HOME`), não `broken_command`. Esse veredito não fica no cache de retomada.
  - Teste: `tests/oxe-1212-local-config.test.cjs`.

## OXB-164: promote reaproveita a própria branch publicada sem PR, limpa depois de ser morto e mostra progresso

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (rc.26).
  - **Branch publicada sem PR:** a recusa obrigava a inventar nomes, e `oxe/promote-tN` velhas acumulavam (o time não apaga branches).
    - Agora a branch é refeita e publicada com `--force-with-lease` sobre o sha atual, se: foi criada por um promote (a marca `branch.<b>.oxePromote` ou um evento `TaskPromote*` com ela), todos os commits depois da base são do promote, e o `gh pr list --head <b> --state all` não acha PR.
    - Com PR (qualquer estado), sem resposta do gh, ou com commits de outra origem, ela continua recusada.
  - **Promote morto no meio:** um promote morto durante o pr:ready deixou `.oxe/promote-ws/t3-*` com o junction do node_modules.
    - O promote grava `<worktree>.pid`. O próximo promote varre as worktrees de pid morto (sem pid: mais de 30 min): desfaz os links **primeiro**, confere que não sobrou link, e só então remove.
    - Ctrl+C ou SIGTERM durante o promote limpam a própria worktree. Um kill duro (Windows) é varrido no próximo promote.
  - **pr:ready longo (10+ min):** roda com progresso no stderr. Uma linha por script npm que começa (`pr:ready: lint ok (42s) · ▶ typecheck`), batimento a cada minuto e o veredito com o tempo. `OXE_PROGRESS=0` desliga, e `OXE_PROGRESS_HEARTBEAT_MS` ajusta o batimento.
  - Teste: `tests/oxe-1212-promote-reuse.test.cjs`.

## OXB-165: o execute abortava com `global_timeout` aos 30 min

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: o `maxRunDurationMs ?? 30 min` do scheduler não tinha CLI nem config, e a run abortava na primeira fronteira de onda depois de 30 min.
  - O padrão do execute agora é sem limite (a guarda de progresso parado cobre os travamentos). `--max-run-ms` e `executor.max_run_ms` definem um.
  - O `TaskPromoteFailed` passou a ter `reason`.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs`.

## OXB-166: o trailer da tarefa colidia entre fases (BLOQUEANTE)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: o `runtime promote T4/T5/T6` da F2 (rc.26) fez cherry-pick de faeded75, 56b39b46 e 966eb527, que são a T4, a T5 e a T6 **da F1** (04/11, `OXE-Task: T4`…), e deu conflito. Os ids T recomeçam a cada fase.
  - O checkpoint agora leva `OXE-Task: F2/T4` (a fase do PLAN.json ou a fase ativa do programa) e `OXE-Run: <run>`. Sem fase em jogo, continua `OXE-Task: T4`.
  - A busca (promote, `findTaskCheckpoint` e o lint "já tem checkpoint") vai por fase + tarefa. Um trailer sem fase só conta quando não há fase, ou quando foi feito depois do início da fase (as runs dela, rc ≤ 26).
  - Com `done_commit`, o promote nem procura trailers sem fase: usa o `done_commit` e os commits `F2/T4`.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs`, incluindo o promote da T4 da F2 com a T4 da F1 no histórico.

## OXB-167: tarefa `done` sem commit de checkpoint, um verde falso (BLOQUEANTE)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11: a run oxe-run-mw83vtdy-8uzesq marcou a T4 (R0c) e a T5 (R12) `done: true` com `done_commit: null`. As mudanças (2 arquivos novos, SkillsBrowser apagado e mais 12) ficaram staged e unstaged na árvore enquanto a T6 e a T7 commitavam por cima.
  - A falha do commit (por exemplo, um hook de pre-commit) era engolida, e a tarefa ia para `done` do mesmo jeito.
  - **Invariante:** com checkpoint commits ligados, uma tarefa só fica `done` quando o commit dela existe e contém as mudanças do escopo. Escopo sem mudança continua `done` sem commit, como antes.
  - **Commit que falha** (add/commit/hook) **ou que fica incompleto** (arquivo do escopo fora dele):
    - a tarefa **não** fica done e o PLAN.json ganha `checkpoint_failed` (motivo, run, commit parcial e o que sobrou);
    - o índice volta (`git reset -- <escopo>`), sem nada meio staged, e o trabalho continua na árvore;
    - sai o evento `CheckpointFailed`, o resultado tem `status: checkpoint_failed` e `checkpoint_failed[]`, e a CLI imprime ✗ com o motivo e sai com código 1.
  - **O próximo execute** tenta o commit dessas tarefas **antes de tudo**, sem turno do executor e sem verify novo. Se o commit entra, a tarefa fica done com o sha (evento `CheckpointRetried`). Senão, ela segue pendente.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs` (hook de pre-commit que reprova, índice limpo, retry sem executor, done com o sha).
  - Também: o teste da OXB-153 era instável sob carga (o limite de 400 ms também estourava na 2ª chamada). Agora o limite é 2 s.

## OXB-168: checkpoint rejeitado por caminho do escopo que outra tarefa já removeu (BLOQUEANTE)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11, depois que a OXB-167 trouxe a causa à tona. O `checkpoint_failed` da T4 (run oxe-run-mw83vtdy-8uzesq) dizia: `git commit falhou: error: pathspec 'electron/main/mcp-internal/documentation-handler.ts' did not match any file(s) known to git · …`.
  - O commit usava o **escopo** da tarefa como pathspec. Numa fase de remoção, a T7 já tinha apagado e commitado `services/documentation`, o escopo da T4 ainda citava esses caminhos, e o git rejeita o commit inteiro por um único pathspec desconhecido.
  - O commit agora sai do que **mudou** sob o escopo. O `git status -z` (que aceita pathspec sem correspondência) dá os arquivos novos, alterados, apagados e os dois lados de um rename. Depois vêm `git add -A` e `git commit` só nesses caminhos.
  - Uma remoção já staged (`git rm`) não passa pelo `add`, que falharia, e entra no commit.
  - Um caminho do escopo que não existe nem no disco nem no git vira `scope_absent` no resultado, não erro.
  - O promote não usa o escopo como pathspec: escolhe commits.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs` (escopo com caminhos que a T7 já removeu, arquivo novo, alterado, apagado e uma remoção já staged, tudo num commit; e `scope_absent`).

## OXB-169: promote na ordem dos commits (tarefas commitadas fora da ordem do plano)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F2, rc.29): o retry de checkpoint commitou a T4 e a T5 **depois** da T6 e da T7, e o `promote T4` sobre a oxe/f2-t3 deu conflito em `tests/integration/fs-allowlist.test.ts`. O diff da T4 já supunha as remoções da T6 e da T7. Os quatro commits em ordem de commit aplicaram limpos (PR #727).
  - `runtime promote --tasks T4,T5,T6,T7` monta **uma** branch com os commits das tarefas na ordem do histórico, não na do plano. Leva os testes congelados de todas e um corpo de PR com cada tarefa. As dependências fora do conjunto continuam empilhando (OXB-161).
  - Promote de uma tarefa só: se commits de outras tarefas, não promovidos, vêm **antes** dos dela e mexem nos mesmos arquivos, sai um aviso com a sugestão `--tasks …`. A mensagem de conflito também nomeia as tarefas e o comando combinado.
  - `plan lint` avisa quando o commit de uma tarefa veio antes do de uma tarefa da qual ela depende.
  - Teste: `tests/oxe-1212-promote-commit-order.test.cjs` (T2 commitada antes da T1: a T1 sozinha conflita e o aviso nomeia a T2; `--tasks T1,T2` aplica sem conflito, em ordem de commit; aviso do lint).

## OXB-170: o checkpoint levava as mudanças de outra tarefa (P0, correção)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11.
  - O que aconteceu: a rc.28 foi morta com a T8 (remoção do RTK) em andamento. O retry de checkpoint da rc.29 commitou a T4 (0f72f6c7) e a T5 (335fc004) **com as edições parciais da T8**: entradas rtk do fs-allowlist e 12 linhas de locale.
  - Consequência: o PR #727 reprovou no typecheck do CI (TS2345 nas chaves rtk). O verify da tarefa (só vitest) não pegou.
  - **O commit leva só o conteúdo da tarefa, pelo índice.** O working tree nunca é tocado, e as edições de outra tarefa ficam lá para o retry dela.
    - Arquivo limpo no início da tarefa: entra como está.
    - Arquivo já sujo no início (edições de outra tarefa): entra só o diff da tarefa, `HEAD + (conteúdo no início → conteúdo agora)` por `git merge-file`. Se as mudanças se sobrepõem, a tarefa falha alto e nada é misturado.
    - O snapshot da árvore guarda os blobs (`hash-object -w`) para isso.
    - O que a pessoa tinha staged em outros caminhos é preservado.
    - Os hooks rodam, porque é um `git commit` normal.
  - **Retry:** o `checkpoint_failed` guarda um `snapshot` (caminho → blob) do conteúdo da tarefa no momento da falha, e o retry commita **exatamente** esse conteúdo, seja o que for que a árvore tenha agora.
    - Registro antigo, sem snapshot (rc ≤ 29): o retry recusa caminhos de outra tarefa pendente ou interrompida, com a dica de commitar à mão e rodar `plan done`.
  - **Relançamento:** a tarefa que tinha `AttemptStarted` sem fim na última run e deixou sujeira no próprio escopo é atribuída antes de qualquer checkpoint (evento `InterruptedWorkFound`).
    - Quando ela roda de novo, essas edições contam como **dela**: saem do baseline, e o commit dela as leva.
  - **`checkpoint_check`** (config, por exemplo `npm run typecheck`): roda na árvore do próprio commit, numa worktree temporária. Vermelho desfaz o commit, e a tarefa fica `checkpoint_failed`. É opt-in, porque custa um typecheck por tarefa.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs`.
    - A com checkpoint falho, B interrompida com edição no mesmo arquivo, relançamento: o commit de A não tem nada de B, B vê as próprias edições parciais e o commit dela as leva.
    - Checkpoint ao vivo sobre arquivo já sujo.
    - `checkpoint_check` vermelho desfaz o commit.

## OXB-171: o teste congelado precisava de arquivo fora do escopo da tarefa (P0)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F2, run oxe-run-mw83vtdy-8uzesq).
  - A T8 (R4) falhou 3 tentativas em `tests/acceptance/f2/r4-removal.test.ts` "its IPC channel groups are gone". O teste importa `shared/types/ipc.ts`, que não estava nos files da T8.
  - Outras 9 tarefas da F2 tinham o mesmo buraco, e o lint ficou verde. Os eventos não traziam a saída (o `failed_segment` só tinha comando e exit code).
  - **`plan lint`:** resolve os imports estáticos relativos de cada teste congelado e os caminhos literais que ele lê, e compara com os files da tarefa (e das tarefas de que ela depende).
    - Imports: `import`, `import()`, `require`, `vi.mock`. A resolução segue node/TS (extensões, `.js`→`.ts`, `dir/index.*`).
    - Leituras: `readFileSync`/`existsSync`/… com literal, `path.join(__dirname|process.cwd(), …)` e `new URL(…, import.meta.url)`.
    - Fixtures e helpers da árvore dos testes não contam. Aliases (`@/…`) não são resolvidos.
    - O aviso é "T8: o teste congelado … importa shared/types/ipc.ts, fora de files — …", com a dica de correção. `lint.test_scope: "error"` torna fatal.
  - **Execute:** quando o teste que falha é um desses (o nome dele aparece na saída) e ele precisa de arquivo fora do escopo, a tarefa para na **1ª tentativa** com `scope_insufficient` (evento `ScopeInsufficient` com os arquivos, os testes e a saída). Também para quando o próprio agente diz que a mudança está fora do escopo. `executor.scope_insufficient: "retry"` desliga.
  - **Eventos:** o `failed_segment` do `VerificationCompleted` agora leva as ~40 últimas linhas do segmento. RetryScheduled e WorkItemBlocked já levavam a cauda, agora sem o ruído do git (OXB-162).
  - Teste: `tests/oxe-1212-test-scope.test.cjs` (o formato da F2 no lint; dependência dona do arquivo sem aviso; fixture que para em 1 tentativa com `scope_insufficient` e cauda; agente que reporta fora do escopo).

## OXB-172: tarefa done antes dos testes que importam os arquivos dela passarem

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11.
  - O que aconteceu na F10: T1 e T2 ficaram done com o verify verde. Depois, o pr:ready do `promote --tasks T1,T2` reprovou 2 testes de `tests/integration/remote-gateway-protocol.native.test.ts`, que nenhuma das duas listava. Corrigir custou um CR, uma tarefa nova e um segundo promote.
  - O PR #727 da F2 mostrou o mesmo padrão, com 7 vermelhos.
  - Com `checkpoint_related_tests` ligado, o checkpoint roda os testes relacionados **aos arquivos que a própria tarefa mudou** (`vitest related`, não o diff do programa inteiro), na árvore do commit, junto com o `checkpoint_check`. Vermelho desfaz o commit, e a tarefa fica `checkpoint_failed` com os testes nomeados.
    - **Teste no escopo da tarefa:** `kind: related_tests`. O próximo execute roda a tarefa com esse teste somado ao verify dela, e o agente vê a falha.
    - **Teste fora do escopo:** `kind: scope_insufficient`, com o arquivo nomeado (evento `ScopeInsufficient` `at: checkpoint`). A tarefa **espera**, sem re-rodar às cegas, até uma edição do plano ou um CR. `plan reopen` limpa a marca.
    - Interface: `checkpoint_related_tests: true` ou `{ command, run_command, max_files (40), timeout_ms (10 min) }`.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs`.
    - Uma tarefa muda um módulo importado por um teste fora do verify e do escopo dela: commit desfeito, `scope_insufficient` com o teste nomeado, a tarefa espera, e o `plan reopen` limpa.
    - O mesmo teste no escopo: `related_tests` e o teste no verify do próximo compile.
    - Desligado por padrão.

## OXB-173: `feedback --tasks` reabria tarefa done com commit, e ids posicionais renumeravam o trabalho interrompido

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (CRs em fases em execução na rc.30).
  - **`--tasks` liga, não reabre.**
    - O que aconteceu: o CR-36 da F2 sobre a T5 (335fc004) e o CR-F10-2 sobre a T1/T2 (1a9e55f6, c2e73cc8) viraram as tarefas para `done=false` sem aviso.
    - Agora `runtime feedback --tasks T5` só **liga** o CR às tarefas: elas vão em `tasks` no CR e em `linked_tasks` no resultado, e continuam done. Só reabre com `--reopen`, e a saída nomeia o que reabriu ("o próximo execute refaz").
    - Sem `--tasks`, segue o comportamento da 1.21.1/OXB-061: reabre a tarefa que fecha o critério.
  - **Ids posicionais.**
    - O que aconteceu: o CR36 entrou como T8 enquanto a T8 (R4) tinha trabalho interrompido na árvore. A atribuição da rc.30 é por id.
    - O trabalho interrompido agora é atribuído pelo **título** que a run interrompida compilou para aquele id: o `InterruptedWorkFound` traz `renumbered: { from, title, to }`. Se ninguém tem o título, nada é atribuído, e esses caminhos ficam recusados para as outras tarefas.
    - O `checkpoint_failed` guarda o título, e um retry de snapshot num id cujo título mudou é recusado.
    - O `plan lint` avisa quando uma tarefa pendente tem título diferente do que a run compilou para o mesmo id ("ids renumerados … acrescente tarefas no fim").
  - Testes:
    - `tests/oxe-1212.test.cjs`: feedback numa tarefa done mantém done, e `--reopen` reabre.
    - `tests/oxe-1212-checkpoint-phase.test.cjs`: um CR36 inserido antes da R4 interrompida; os restos ficam com a R4 (agora T3), o commit do novo T2 não os leva, e o lint avisa.

## OXB-174: os restos da própria tarefa, de tentativas falhas, ficavam fora do commit dela (P0, regressão da OXB-170)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F10, run oxe-run-mw8cmpin-0373tc).
  - O que aconteceu: a T3 falhou 3× na rc.30, e as edições dela em desktop.ts e filters.ts (no escopo) ficaram na árvore. O relançamento completou a T3 sem mexer nesses arquivos de novo.
  - O checkpoint 447aafdd levou só o teste. Os dois arquivos estavam sujos no início da tentativa nova, então "início → agora" deu diff vazio.
  - No início de uma tarefa com tentativas anteriores **não concluídas** (falhou ou foi interrompida, em qualquer run), os caminhos sujos do escopo dela contam como **dela** quando:
    - ela os escreveu nessas tentativas (`ExecutorUsage.writes`); ou
    - nenhuma outra tarefa pendente os tem no escopo.
  - Caminho que o trabalho interrompido de **outra** tarefa segura continua recusado (OXB-170). Evento: `OwnLeftoversAttributed`.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs` (a A falha com edições no escopo e a run seguinte a completa sem tocá-las: o commit as contém; os restos interrompidos da B num arquivo compartilhado continuam fora do commit da A).

## OXB-175: `checkpoint_related_tests` desfazia commits bons por testes vermelhos de propósito (P0, regressão da OXB-172)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 08/11 (F2, rc.31).
  - O que aconteceu: o checkpoint da T9 (CR37) foi desfeito (e98c9d54) por três testes que estão vermelhos de propósito: um teste congelado estacionado da F3, uma reprodução de CR e o teste congelado de uma tarefa **posterior** da F2.
  - Pior: o execute **começou a tarefa seguinte** com as edições do CR37 fora de commit, a mistura que a OXB-170 evita. O FRONTEND tinha verificado o commit verde.
  - Agora um vermelho relacionado só conta como da tarefa quando:
    - o teste **não** é um teste de aceite congelado de tarefa **pendente** deste plano, nem de outra fase (em `acceptance/`, sem dono no plano), nem de uma pasta `parked*/`. Testes de tarefas já done continuam contando, porque são regressão;
    - ele estava **verde no commit pai**. Os candidatos rodam com o `run_command` na árvore do pai, e o que já estava vermelho antes não é da tarefa.
  - Os vermelhos ignorados saem em `check.ignored_reds`.
  - **Uma falha de checkpoint para a corrente:** a run é cancelada logo depois, e nenhuma tarefa seguinte começa sobre trabalho não commitado. O resultado sai com `status: checkpoint_failed` e `stopped_after_checkpoint_failure`.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs`.
    - Testes de tarefa pendente, de pasta parked e de reprodução de bug: commit feito.
    - Vermelho também no pai: commit feito.
    - Vermelho real (verde antes): checkpoint falha e a T2 nunca começa.

## OXB-176: tarefa reaberta completava sem checkpoint e a run seguia (P0)

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 09/11 (F4, run oxe-run-mw855cc1-yap7sx, rc.32).
  - O que aconteceu: a T4, deixada sem commit pela rc.31, foi reaberta com `plan reopen`. A tentativa nova não mudou nada, o diff próprio deu vazio, e não houve **nenhum** evento de checkpoint: a T4 "completou", o HEAD ficou na T3 e a T5 começou. O typecheck da T5 reprovou porque usava o que a T4 registra.
  - O `ownLeftoversByTask` (OXB-174) pulava a tarefa que já tinha completado antes. Agora o PLAN.json é a autoridade: tarefa que já rodou e **não está done** (falhou, foi interrompida, ou completou e foi reaberta) herda os restos do próprio escopo, com as mesmas regras de posse.
  - **Completou sem diff próprio:**
    - escopo limpo e um checkpoint anterior da tarefa: done com esse commit (`GateResolved reused`);
    - senão, **`empty_checkpoint`**: checkpoint falho, não done, a run para (OXB-175) e nenhuma dependente começa. A mensagem diz se havia mudanças no escopo não atribuídas, que o próximo execute atribui e commita.
  - Tarefas sem escopo de arquivos (verify-only, entrega externa, spike) continuam como antes.
  - Mudou o comportamento da OXB-167 para "nada mudou no escopo": antes ficava done sem commit, agora é `empty_checkpoint` quando não há checkpoint anterior.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs` (a A reaberta com as edições na árvore e uma tentativa sem escrita: a A commita, e a B só começa depois do commit; nada mudou e sem checkpoint anterior: `empty_checkpoint`).

## OXB-177: arquivo de dois escopos commitado inteiro pela primeira tarefa que fazia checkpoint

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 09/11 (F2, rc.32).
  - O que aconteceu: a R6 (Linear), interrompida, deixou `shared/mcp-coverage.ts` editado. O CR37, que tem o mesmo arquivo no escopo por um hunk só, fez o checkpoint b9bc1a44 com o arquivo **inteiro**, remoções da R6 incluídas. No PR #727 isso reprovou `tests/mcp-coverage.test.ts`.
  - Havia duas causas:
    - a interrupção da R6 era de uma run **anterior**, e a detecção da OXB-170 só olhava a última run;
    - o CR37 tinha escrito o arquivo numa tentativa anterior, e a OXB-174 atribuiu o arquivo inteiro a ele.
  - **Interrupção em qualquer run:** tarefa não-done cuja última `AttemptStarted`, em qualquer run, não tem fim **na mesma run**. Um bloqueio emitido numa run que nem a começou (fora do `--wave`, dependência bloqueada) não encerra a interrupção.
  - **Base da 1ª tentativa:** no início da primeira tentativa de cada tarefa, o oxe-build grava `.oxe/task-baselines/<tarefa>.json` (caminhos sujos → blob, com o título para detectar renumeração). Ela é apagada quando a tarefa fica done.
  - **Caminho compartilhado** (sujo, e reivindicado por trabalho interrompido de outra tarefa ou no escopo de outra tarefa pendente), nunca commitado inteiro:
    - na base da 1ª tentativa: a tarefa commita `HEAD + (base → agora)` pelo merge-file da OXB-170, só os hunks dela;
    - reivindicado por outra tarefa interrompida: é da tarefa só se ela também o escreveu. Nesse caso, sem base, não dá para separar: **`shared_file_conflict`** nomeando as duas tarefas, e nada é commitado;
    - só no escopo de outra tarefa pendente: é da tarefa quando ela o escreveu (`ExecutorUsage.writes`).
    - Um conflito do merge-file num arquivo compartilhado também sai como `shared_file_conflict`, com os nomes.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs`.
    - A interrompida com H1 em F; B muda H2 em F e faz checkpoint: o commit da B tem só H2 e A continua vendo H1.
    - B com uma tentativa anterior que escreveu F: continua só H2.
    - Sem a base (histórico anterior): `shared_file_conflict` e nenhum commit.

## OXB-178: `checkpoint_related_tests` desfazia o commit por um vermelho pontual

- **Status:** resolvido (1.21.2). Registrado pelo TECH LEAD em 09/11 (F4, rc.36).
  - O que aconteceu: a T9 (CR-F4-1) teve o checkpoint desfeito como `scope_insufficient` por `tests/integration/policy-change-gate.test.ts` vermelho. Rodado de novo logo depois, na mesma árvore, deu 33/33 verde: provável pressão de memória com três fases na máquina.
  - Antes de contar um vermelho relacionado contra a tarefa, cada arquivo de teste que falhou roda **mais uma vez, sozinho, na árvore do commit** (`run_command`). Só conta se ficar vermelho de novo.
  - Os que passam no rerun vão para `check.flaky_reds` (`{ file, first: red, rerun: green }`), que aparece no `GateResolved` do checkpoint. O commit é mantido.
  - A ordem dos filtros: exclusões da OXB-175 (aceite de tarefa pendente, outra fase, parked), depois o rerun na árvore do commit, depois o vermelho também no pai.
  - Teste: `tests/oxe-1212-checkpoint-phase.test.cjs` (vermelho na 1ª execução e verde no rerun: commit mantido e `flaky_reds` com o teste). O fixture da OXB-175 passou a ficar vermelho conforme a árvore, como um teste real.

## OXB-120: classificar a falha antes de cobrar uma tentativa

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação (BACKLOG-gsd).
  - Só a falha de **lógica** consome tentativa. As outras pausam a run com um diagnóstico.
  - **`environment`:** saída 126/127, executável ausente ("command not found", "is not recognized"), artefato de build não construído (ENOENT em out/dist/build/lib), módulo de outro pacote ausente, módulo nativo de outra versão do Node, rede (ECONNREFUSED, ENOTFOUND, EAI_AGAIN…), disco ou memória.
    - O verify que falha assim pausa a run (`RunPaused` com `reason: environment` e a linha do diagnóstico). A tarefa fica bloqueada (`paused_environment`), sem retry, e nenhuma outra tarefa começa.
  - **`quota`:** limite de uso do provedor. Pausa a run com o horário de retomada quando a mensagem traz ("resets at …", "try again in …").
  - **`flaky`:** coberto pelo `flaky_suspect` (OXB-162) e pela quarentena (OXB-117 b).
  - Padrões do projeto: `execute.failure_classes: { environment: [regex], quota: [regex] }`.
  - O resumo do execute mostra "PAUSADA: ambiente — <diagnóstico>". Para retomar, rode `oxe-cc runtime execute` de novo: ele pula o que está done e começa a tarefa pausada com tentativas novas. (O `runtime resume` existente continua sendo o par do `runtime pause`.)
  - O scorecard não conta tarefa pausada como tentativa.
  - Teste: `tests/oxe-1212-failure-classes.test.cjs` (exit 127 pausa com uma chamada só e a T2 não começa; falha de lógica segue com retry; padrão do projeto; cota com horário de retomada; o classificador).

## OXB-124: veredito e sign-off presos ao commit e à versão do critério

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-verdicts.cjs`.
  - O `runtime signoff` grava `head` (o commit avaliado; `--head <sha>` para outro) e `criteria_versions` (hash da linha de cada critério na SPEC). O verify da fase grava `verification_head`. O anexo de CI já levava `--head`.
  - **No close:**
    - um sign-off só conta enquanto o `head` dele for ancestral do HEAD de fechamento, sem commit depois dele no escopo do critério, e com a versão atual do critério;
    - o escopo do critério são os files das tarefas que o cobrem; sem tarefa, qualquer arquivo fora de `docs/` e `.md`;
    - quando não conta, sai `stale_verdict` com o motivo (commit novo no escopo, critério emendado, commit fora da história) e o comando para refazer;
    - sign-off antigo, sem `head`, também é obsoleto, com mensagem de migração;
    - o verify da fase também precisa ser do código que está sendo fechado: mudança de código depois do `verification_head` dá `stale_verdict` com o pedido de rodar o verify de novo.
  - Teste: `tests/oxe-1212-verdict-head.test.cjs` (sign-off e commit em `src/`: obsoleto; commit só em `docs/`: vale; emenda do A70: obsoleto; sign-off sem head: obsoleto).

## OXB-119: guardas na ferramenta para os agentes do programa

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-guard.cjs`.
  - `oxe-cc guards install` (ou `oxe-cc install --guards`) grava, por projeto e por opt-in, o hook `PreToolUse` no `.claude/settings.json`. `guards status` e `guards uninstall` existem; o uninstall remove só o hook do OXE.
  - O guarda bloqueia **antes** da ação (saída 2 com o motivo):
    - (a) escrita fora da raiz do projeto ou worktree, por Write/Edit/MultiEdit/NotebookEdit e também por redirecionamento ou `tee` no shell;
    - (b) leitura de caminho `deny_read` das `policy_rules` por qualquer ferramenta: Read, Grep, Glob e shell (`cat`, `type`, `head`, `git show ref:caminho`, dentro de `$( )` e de `bash -c`);
    - (c) comando `deny` das regras;
    - (d) comando pesado (`guards.heavy`) sem o wrapper de lock (`guards.heavy_wrapper`), com a sugestão do comando certo.
  - `git checkout|switch|stash|reset|clean|restore` em `guards.protected_checkouts` também é bloqueado.
  - Falha fechado: um erro interno bloqueia e explica. Cada bloqueio vira `PolicyBlocked` no OXE-EVENTS. `guards.enabled: false` desliga.
  - Teste: `tests/oxe-1212-guards.test.cjs` e `tests/oxe-1212-findings-seams-deps.test.cjs` (install/uninstall).

## OXB-127: auditar dependências no diff da tarefa e da fase

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-deps-audit.cjs` e o comando `oxe-cc runtime deps [--base <sha>]`.
  - Quando o diff mexe em package.json ou no lockfile:
    - (a) roda `npm audit` na base e na branch; advisory high/critical **nova** bloqueia, a que já existia na base não;
    - (b) cada pacote novo precisa existir no registro (`npm view`); nome inexistente bloqueia, e nome a uma letra (ou uma troca de vizinhas) de um pacote popular é listado para conferência;
    - (c) dependências nativas adicionadas e removidas (`hasInstallScript`/`gypfile`) são listadas, com o lembrete de rebuild e de teste de presença.
  - O resultado vai para `deps.md` no dossiê. Na fase vira gate implícito `deps` (só quando o diff da fase mexe no manifest). `deps.block` no config muda as severidades que bloqueiam.
  - Teste: `tests/oxe-1212-findings-seams-deps.test.cjs` (registro e audit simulados).

## OXB-136: revisão de costura no close da fase

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-seams.cjs` e o comando `oxe-cc runtime seams`.
  - Sobre o diff da fase, de forma determinística:
    - (a) arquivos mexidos por mais de uma tarefa (pelos trailers `OXE-Task`) e exports alterados ou removidos com consumidor em arquivo de outra tarefa;
    - (b) helpers duplicados (mesmo corpo normalizado, ≥ 4 linhas, em arquivos diferentes);
    - (c) arquivos que cresceram acima do limite somando as tarefas (`close.seams.grow_limit_lines`, padrão 300);
    - (d) ações da retro anterior sem evidência (`runtime seams --retro-add "…"` grava `RA-<fase>-<n>`, e `--retro-done RA-… --evidence …` fecha);
    - (e) critério cujo "Como verificar" pede o fluxo de ponta a ponta sem uma execução registrada (`--behavior-ran A5 --evidence …`).
  - O relatório vai para `seams.md` no dossiê. No close, (e) bloqueia por padrão (`close.seams.require_behavior_run: false` desliga) e (d) bloqueia com `require_retro: true`.
  - Teste: `tests/oxe-1212-findings-seams-deps.test.cjs`.

## OXB-137: severidade fixa para achados, lida de uma tabela

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-findings.cjs` e `oxe/templates/finding-rules.json`.
  - A tabela padrão vem no pacote, com 12 regras: data-loss e security (critical); crash, a11y-serious, contract-break e gate-red (high); behavior-wrong, i18n-raw, build-order e perf-regression (medium); stale-copy e polish (low).
  - `.oxe/finding-rules.json` acrescenta regras e pode **subir** a severidade de uma regra do pacote, nunca baixar. Uma tentativa de baixar é ignorada com aviso.
  - `runtime feedback --rule <id>` grava `rule` e `severity` no CR, com a severidade vinda da tabela. Informar uma severidade diferente é recusado, e severidade sem regra também. Sem regra, o achado é observação (`unrated`).
  - O close bloqueia em `close.block_on` (padrão: qualquer `critical` e `high` num critério permanente).
  - Teste: `tests/oxe-1212-findings-seams-deps.test.cjs`.

## OXB-138: adiar a tarefa que não converge e seguir com as independentes

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-deferred.cjs` e o comando `oxe-cc runtime deferred [retry] [--dry-run]`.
  - Uma tarefa que esgota as tentativas fica **adiada** (`WorkItemDeferred`), e a run continua.
    - As tarefas que dependem dela, direta ou transitivamente, ficam `blocked_by_deferred` e não rodam.
    - As independentes seguem e pousam. Os arquivos da adiada são restaurados pelo isolamento de tentativa falha (OXB-051).
    - `execute.defer_failed: false` volta ao comportamento antigo (a run para na onda com falha).
  - **Ledger** em `.oxe/program/deferred.ndjson`: `AD-<fase>-<n>`, com o motivo (a classe da falha) e a última evidência. Uma falha nova da mesma tarefa atualiza a entrada.
  - **`runtime deferred retry`** classifica cada entrada aberta contra a árvore atual:
    - já resolvida (o verify passa agora): fecha a entrada;
    - pronta para refazer: o próximo execute a roda, já que continua pendente;
    - feita por outro caminho (done no PLAN.json): fecha a entrada;
    - decisão humana: tarefa sem verify.
  - Entradas abertas entram no registro de defeitos (OXB-110) e bloqueiam o close, salvo dispensa com motivo.
  - Teste: `tests/oxe-1212-deferred.test.cjs` (T1 esgota, T3 e T4 pousam, T2 bloqueada; o ledger e o bloqueio no close; o retry "já resolvida"; o modo antigo).

## OXB-123: sondas de borda e de proibição na spec

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-spec-probe.cjs` e o comando `oxe-cc spec probe [A<n>…|--all]`.
  - **Sonda de bordas:** para cada critério A*, uma taxonomia fechada levanta só as categorias que o texto pede: limite, vazio, adjacência, encoding/locale, ordem, precisão, idempotência, concorrência, teclado e foco.
    - Cada borda vira uma linha `A<n>.e<k>` em `## Bordas`, com a pergunta, e o status `coberta | descartada | prova_extra | aberta`.
  - **Sonda de proibição:** grava critérios negativos `N<n>` em `## Proibições` (perda de dado, vazamento, dependência de rede quando local, travar a interface, erro cru), com nível `teste | julgamento`.
  - O `spec probe` é idempotente: só acrescenta para os critérios que ainda não têm linhas.
  - **Lint:** status inválido e borda descartada sem motivo são erro. Borda aberta sem suposição no plano (`assumptions` com o id) é aviso.
  - **Close:** borda `prova_extra` e proibição `julgamento` sem evidência ficam `needs_human` e nunca passam sozinhas. O `runtime signoff` passou a aceitar ids `N<n>` e `A<n>.e<k>` com `--evidence`.
  - Teste: `tests/oxe-1212-spec-probe.test.cjs`.

## OXB-126: detectar plano velho antes do execute

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-plan-staleness.cjs`.
  - O PLAN.json guarda `base_sha`, o commit contra o qual foi escrito (`oxe-cc plan staleness --stamp`). Uma tarefa pode ter o próprio `base_sha` depois de revisada.
  - **`oxe-cc plan staleness`:** os commits desde a base, sem os checkpoints das próprias tarefas do plano, cruzados com cada tarefa pendente: os files dela, os arquivos dos símbolos do pack e os testes congelados. Aponta arquivo mudado, caminho removido e teste mudado, por tarefa.
  - **O execute recusa** (`plan_stale:Tn` no preflight) enquanto houver interseção.
  - **`oxe-cc plan refresh --tasks T3[,T7]`** registra que a tarefa foi revisada contra o código atual (`base_sha` e `refreshed_at` na tarefa). Ids e tarefas done são preservados. O conteúdo da revisão é do planner; o comando só grava o ponto de referência.
  - **Fase em esboço:** PROGRAM.json `detail: "sketch"` na fase. Ela não executa (`phase_sketch` no preflight) até o plano ser detalhado.
  - Teste: `tests/oxe-1212-plan-staleness.test.cjs` (merge que mexe no escopo da T3 e remove um arquivo: o execute recusa nomeando a T3, e o checkpoint da T1 não conta; refresh; fase em esboço).

## OXB-125: canal de pergunta do executor

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. `bin/lib/oxe-questions.cjs` e a ferramenta `ask_orchestrator` em `packages/runtime/src/executor/built-in-tools.ts`.
  - **A ferramenta:** diante de um contrato ambíguo (duas leituras, uma âncora que não decide, um teste e o código discordando), o executor chama `ask_orchestrator` com `{question, options, default, blocking}` em vez de adivinhar.
  - **O orquestrador responde, nesta ordem:**
    1. a mesma pergunta já respondida por uma pessoa;
    2. uma decisão ativa que nomeia uma das opções e compartilha os termos da pergunta (a fonte é o id da decisão);
    3. bloqueante, ou com um termo de `execute.interrupt_on`, sem evidência: vira `Q-n` em espera, e a tarefa para com `waiting_answer`, sem retry;
    4. senão, o default do executor, gravado como decisão provisória (`by: executor (provisória)`).
  - **Eventos e comandos:**
    - eventos `ExecutorQuestion` e `ExecutorQuestionAnswered`;
    - `oxe-cc runtime questions [--json]` lista as perguntas;
    - `oxe-cc runtime questions answer Q-n --answer "…"` responde e grava a decisão;
    - o preflight do execute recusa enquanto houver uma pergunta em espera (`question_waiting:Q-n`).
  - Teste: `tests/oxe-1212-questions.test.cjs`, com 4 cenários: resposta pela decisão; default provisório; bloqueante e `interrupt_on` em espera, a resposta desbloqueia e é reaproveitada; a tarefa em `waiting_answer` não é retentada.

## OXB-128: prova de UI reproduzível para o sign-off permanente

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. Implementado em `bin/lib/oxe-ui-evidence.cjs`.
- **O pacote:** `<pasta>/ui-evidence.json` (schema 1), com:
  - `sha` avaliado;
  - matriz locale × tema × SO;
  - por execução, um roteiro com seletores estáveis (`role` + `name`; `selector` livre ou CSS/XPath são recusados);
  - capturas com baseline e `diff_ratio` (limite `diff_threshold`, padrão 0,01);
  - um relatório de acessibilidade por estado capturado, com zero violações;
  - `findings` com roteiro.
- **`oxe-cc runtime ui-evidence validate <pasta>`:** recusa uma matriz incompleta, diff acima do limite, seletor instável, captura ou relatório ausente e violação de a11y.
- **O sign-off:** quando um critério permanente de UI é assinado (opt-in em `ui_evidence.criteria: ["A70"]`, ou `ui_evidence.standing: true`, que detecta pelo texto do critério), o sign-off só aceita o pacote válido do mesmo commit (`sha` = HEAD). O registro guarda `ui_evidence`.
- **`runtime signal --from <pasta> --freeze`:** cada achado com roteiro vira um teste Playwright (`getByRole`) congelado em `tests/ui-regression/<id>.spec.js` (configurável por `ui_evidence.test_dir`). O teste é registrado em PLAN.json `acceptance_tests`, com `frozen`, `origin: ui_evidence` e `regression: next_phase`.
- **Limite:** o "reprova na árvore antiga e passa na corrigida" depende do Playwright do projeto. A suíte do oxe-build valida o teste gerado (seletores e asserção), não o executa num browser.
- **Teste:** `tests/oxe-1212-ui-evidence.test.cjs`.

## OXB-184: o binário regravado por uma tentativa e o retry que não sabe disso

- **Status:** a hipótese do relato não se confirmou. As duas melhorias pedidas foram feitas (1.21.2).
- **Relato do TECH LEAD:** na oxespace-150-f10, CR-A42 (T14), run `oxe-run-mw8cmpin-0373tc`, houve 3 tentativas reprovadas em `verifyPaparazziDebug` pelo mesmo diff de 0,1%. A hipótese era que o rollback descartasse os PNGs regravados antes do verify. O TL chamou o item de OXB-179, mas esse número já é do backlog de comparação, então ele virou OXB-184.
- **O que os artefatos mostram:**
  - **Não houve descarte entre tentativas.** O runtime não reverte nada entre tentativas. O isolamento (OXB-051/067) só roda quando a tarefa falha de vez, depois da última tentativa. Isso confere com `T14-failed/`, salvo às 00:53:33, depois da 3ª tentativa.
  - **Os PNGs regravados chegaram ao verify da mesma tentativa.** A 2ª tentativa regravou 10 goldens de `ComponentsSnapshotTest` (00:47, dentro do escopo). Eles estão em `T14-failed/new/`. No verify dessa tentativa os Components passaram: a falha de 15,8% em `oxeButton` sumiu.
  - **O golden que reprovava nunca foi regravado.** `ScreensSnapshotTest_live[pt-rBR-true]_live-tasks.png` reprovou com o mesmo 0,103431% nas tentativas 2 e 3 e não aparece entre os arquivos salvos da tentativa. Ou o executor não o regravou, ou a regravação reproduziu bytes iguais aos do HEAD e a renderização variou entre o record e o verify.
  - A correção real (c49e87e2, "the live-tasks fixture uses a real delegation state") aponta para a fixture, não para o oxe-build.
- **Defeito real encontrado:** um execute posterior da mesma run recomeça a numeração das tentativas e sobrescrevia `attempts/T14-1.log`. O T14-1.log das 01:31 não é a 1ª tentativa das 00:4x. Agora o log anterior é mantido como `T14-1.before-<mtime>.log`.
- **Melhoria pedida:** o prompt do retry ganha a seção "O que a tentativa anterior deixou na árvore". Ela lista os caminhos mudados pela tentativa anterior, binários incluídos, e diz que foram mantidos e que o verify os vê. O scheduler expõe `ctx.attemptChanges`, e o inplace preenche a seção a partir do snapshot da tentativa.
- **Teste:** `tests/oxe-1212-attempt-changes.test.cjs`. Um PNG regravado na tentativa 1 está no verify, o retry o lista como mantido e a tarefa conclui na tentativa 2.

## OXB-178b: revisão independente num processo separado, com recibo

- **Status:** resolvido (1.21.2). Item P1 do backlog de comparação. No backlog de origem ele é o OXB-178; como esse número já era o do rerun dos vermelhos relacionados, aqui ele se chama 178b. Implementado em `bin/lib/oxe-review.cjs`.
- **O processo:** `oxe-cc review run --role auditor|diff|reader|implementer [--task Tn] [--model m]` roda o revisor num processo novo: `claude -p` sem ferramentas e sem sessão persistida, numa pasta temporária vazia, para que o host não injete CLAUDE.md nem AGENTS.md. O ambiente vai sem OXESPACE_*. O revisor recebe só os arquivos do contrato do papel:
  - auditor e diff: SPEC, decisões, a tarefa e o diff do checkpoint;
  - reader e implementer: SPEC e PLAN.
- **O que entra além disso:**
  - os arquivos que esses artefatos citam e que existem no repositório;
  - os de fora do repositório e as URLs ficam em `external_pending`. Só entram com `--allow-external`, como dado não confiável.
- **O recibo** `.oxe/reviews/<id>/receipt.json` (e `receipt-<rodada>.json`) registra: papel, modelo, os pids do executor e do revisor, o hash do prompt, cada arquivo com seu sha256, os excluídos (PLAN, runs, DISCUSS, EVENTS, STATE) e as instruções do host.
- **Sentinela:** `.oxe/reviews/.sentinel` entra no contexto de cada tarefa do executor e nunca vai para o revisor. Uma resposta que o contém torna a revisão `invalid`.
- **Falha do revisor:** um revisor que termina sem relatório tem uma nova tentativa. Depois disso fica `not_run`, e a rodada é suja: nunca "aprovado".
- **O verify** (`adversarial_verify`) passa a chamar `review run --role auditor` (workflow `verify.md`).
- **Teste:** `tests/oxe-1212-review.test.cjs`. Cobre:
  - os hashes do recibo;
  - a ausência de PLAN e DISCUSS no que o revisor recebe;
  - os citados dentro e fora do repositório;
  - o vazamento do sentinela;
  - as duas falhas que viram `not_run`.

## OXB-179: registro de achados entre rodadas, com regra de convergência

- **Status:** resolvido (1.21.2). Implementado em `bin/lib/oxe-review.cjs`, no `.oxe/reviews/<id>/findings.ndjson` (append-only).
- **O achado:** id estável `<papel>-<rodada>-<n>`, lugar (arquivo e linha, ou critério ou tarefa), regra e severidade da tabela do OXB-137, e estado.
- **"Mesmo problema, mesmo lugar":** mesma regra e mesmo arquivo, com tolerância de 12 linhas, ou mesma regra e mesmo critério ou tarefa.
- **Transições:**
  - um achado encerrado (contestado com evidência, registrado, confirmado pelo dono, waiver) que volta é marcado como repetido e não reabre;
  - um achado corrigido que volta reabre como "correção falhou ou foi desfeita", com o commit da correção.
- **Rodada e convergência:** a rodada é limpa quando não há achado alto ou maior aberto (ou com o dono) e todos os revisores rodaram. A revisão converge com duas rodadas limpas seguidas.
- **Vai-e-volta:** um achado novo dentro de uma correção desta revisão para o laço com a pergunta de três saídas (`decision_needed`).
- **Interface:** `oxe-cc review status [<id>]`, com os achados que estão com o dono primeiro, e o evento `ReviewRound`.

## OXB-139: revisão em contexto limpo com rodadas limitadas

- **Status:** resolvido (1.21.2). Ele usa o 178b e o 179.
- **Config:** `review: { model, max_rounds: 2 }`. Uma tarefa revisada mantém um único id (`diff-T3`), e as rodadas se acumulam nele.
- **No limite de rodadas,** quando um achado alto continua aberto desde a rodada anterior, o OXE abre um CR `spec_gap` (`by: review_repeat`, com o registro `cr_origin` e `origin: review_repeat` em `changes.ndjson`) e não faz outra rodada. Sem achado persistente, o laço para no limite com a pergunta.
- **Revisão sem intenção:** sem tarefa nem critério, é recusada.
- **Modelo do revisor:** `--model` ou `review.model`, diferente do do executor.

## OXB-180: resposta do autor a cada achado

- **Status:** resolvido (1.21.2).
- **O comando:** `oxe-cc review respond <achado>`, com exatamente uma saída:
  - `--dispute --ref <arquivo#símbolo|D-id>`: o arquivo tem que estar no recibo da rodada e o símbolo tem que existir; senão, o motivo é "o revisor não podia ler isto";
  - `--to-owner --reason`: o dono decide com `--owner-confirm` ou `--owner-record "<fato>"`, que cria a decisão `D-*`;
  - `--fix [--commit]`;
  - `--note`: só para severidade baixa;
  - `--waive --reason --by`.
- **O que é recusado:**
  - mudar a severidade (`--severity`);
  - contestar um "não entendi" (`unclear-section`, `summary-mismatch`).

## OXB-181: leitura da spec e do plano por processos sem o contexto

- **Status:** resolvido (1.21.2).
- **O comando:** `oxe-cc plan lint --read [--role reader|implementer]` roda os dois papéis em processos separados (178b), cada um com só a SPEC e o PLAN, sem DISCUSS.
  - O **leitor de fora** resume o que a fase entrega e como funciona hoje. Ele aponta `unclear-section` (alta) e `undefined-term`.
  - O **implementador** aponta cada `open-choice` (alta) por tarefa.
- **A saída:** `.oxe/PLAN-READ.md` e `.json`, com os resumos no topo, mesmo sem achado.
- **O bloqueio:** um achado alto aberto bloqueia o `runtime execute` (`plan_read:<id>` no preflight) até ser respondido (OXB-180) ou receber waiver.
- **Regras novas na tabela:** `unclear-section`, `summary-mismatch`, `open-choice` (high) e `undefined-term` (medium).
- **Teste:** o plano com "atualizar o serviço de autenticação" faz o implementador apontar a T1. O termo "Portal Vex" faz o leitor apontá-lo. O resumo aparece, o preflight bloqueia e o waiver libera.

## OXB-182: a decisão registra as alternativas que perderam e quem as descartou

- **Status:** resolvido (1.21.2). Implementado em `bin/lib/oxe-decisions.cjs`.
- **O registro:** `oxe-cc decision add … --alt "texto::motivo[::por::link]"` (repetível) grava `alternatives[]`.
  - A recusa é do autor por padrão.
  - Atribuí-la a outra pessoa ou papel exige um link: URL, `#123`, PR, `CR-*` ou `D-*`.
  - Os registros antigos, sem alternativas, continuam válidos.
- **Leitura:** `decision list` mostra cada alternativa com o motivo e quem recusou. O `plan lint` avisa quando uma tarefa propõe uma alternativa já recusada: pelo menos 60% dos termos da alternativa, com no mínimo 3. O workflow `plan.md` cita as alternativas das decisões em vez de reescrevê-las.
- **Teste:** `tests/oxe-1212-decision-alts-docs-check.test.cjs`.

## OXB-183: divergência entre os documentos fechados e o código atual

- **Status:** resolvido (1.21.2). Implementado em `bin/lib/oxe-docs-check.cjs`.
- **O comando:** `oxe-cc docs check [--phase Fn] [--json]` lê:
  - as decisões ativas das fases fechadas;
  - os dossiês das fases fechadas;
  - `.oxe/codebase/*.md`.
- **O que confere:** cada caminho e cada `caminho#símbolo` citado como estado atual. Uma linha que planeja criar o arquivo não conta. Os resultados possíveis são:
  - "não existe mais";
  - "mudou de lugar", quando o símbolo é definido em outro arquivo (`git grep`);
  - "check falhou", porque o `check` de toda decisão ativa de fase fechada roda de novo.
- **A saída:** `.oxe/DOCS-CHECK.md`. O comando não corrige nada. O workflow `compact.md` passa a rodá-lo.
- **Fora do escopo:** o aviso no `doctor`. Rodar os `check`s das decisões a cada `doctor` seria lento demais; ele fica no `compact` e sob demanda.
- **Teste:** "mudou de lugar" e "não existe mais" a partir de `src/a.ts#foo`; um arquivo planejado como novo não aparece; um check que falhava e agora passa; menos de 5 s.

## OXB-131: subir o nível de modelo depois de falha branda, com teto

- **Status:** resolvido (1.21.2). Implementado em `bin/lib/oxe-model-tiers.cjs` e `scheduler.ts` (`ctx.modelFor`).
- **Config:** `models: { tiers: { fast, balanced, powerful }, default_tier, escalate_on: ["logic"], max_escalations: 1, overrides: { T3: "<modelo>" } }`.
- **Precedência:** o override, de config ou do `model` da tarefa, vem antes do nível. O nível vem antes do `model_hint` da tarefa. A 1ª tentativa usa o nível da tarefa.
- **Escalonamento:**
  - uma falha `logic` (verify, llm, turn limit) sobe um nível na próxima tentativa, até `max_escalations`;
  - uma falha de ambiente nunca sobe;
  - sem `models` na config, nada muda: vale o modelo padrão do executor.
- **Registro:** `AttemptStarted` grava `model`, `tier` e `escalated`. O adaptador `claude` usa o modelo da tentativa (`--model`), e o `http` também (`model` da completion). O scorecard ganha `sample.cost_by_tier`.
- **Teste:** `tests/oxe-1212-model-tiers.test.cjs`. Cobre a precedência, o teto, o fato de só `logic` escalar, o execute passando `m-fast` e depois `m-bal`, e o custo por nível.

## OXB-133: erros com tipo e código de saída estáveis em toda a CLI

- **Status:** resolvido (1.21.2). Implementado em `bin/lib/oxe-cli-errors.cjs`, com o catálogo em `docs/cli-errors.md`.
- **O envelope:** com `--json-errors` (flag global) ou `OXE_JSON_ERRORS=1`, toda falha imprime uma linha no stderr, `{ ok:false, kind, message, detail, command, hint, exit }`, e sai com o código do `kind`.
- **O catálogo é fechado:** `internal` 1, `usage` 2, `validation` 3, `not_found` 4, `conflict` 5, `gate_failed` 6, `environment` 7. O stdout continua com os dados. Sem a flag, a saída humana não muda.
- **Correção junto:** `oxe-cc plugins <subcomando desconhecido>` saía com 0. Agora é erro de uso (exit 2).
- **Teste:** `tests/oxe-1212-cli-errors.test.cjs`. Os 37 comandos (os do `--help` e os da 1.21.2) devolvem o envelope `usage`/2 num erro de uso, sem escrever nada. O catálogo do código é o do doc. A env var funciona como a flag, e sem a flag a saída é a mesma.

## OXB-132: orçamento de tamanho para workflows e prompts, com variante compacta

- **Status:** resolvido (1.21.2). Implementado em `bin/lib/oxe-workflow-budget.cjs`.
- **O orçamento:** `oxe/workflows/size-budget.json` declara o nível de cada workflow e persona: s ≤ 200 linhas, m ≤ 400, l ≤ 650. O nível fica num manifesto, e não em frontmatter, para não mudar o topo que os wrappers e o sync leem. Um teste do repositório reprova quando um arquivo passa do limite, não está declarado ou é `l` sem variante compacta.
- **A variante compacta:** existe para cada workflow `l` (hoje `plan.md` com 557 → 144 linhas e `spec.md` com 620 → 99) em `oxe/workflows/compact/`. Ela é gerada por `scripts/build-compact-workflows.cjs` (`--check` no teste) e leva os títulos, os passos numerados e toda linha com comando `oxe-cc`, gate ou regra de bloqueio. O teste confere que ela preserva todos os comandos e gates citados na completa.
- **A escolha:** config `context.compact: auto|on|off`. O `runtime context --used --limit` diz qual variante ler; em `auto`, é a compacta quando a folga está abaixo de 30%.
- **`oxe-cc runtime context-pack --task T3 [--stats]`:** grava `.oxe/context-packs/T3.json` com a tarefa, as dependências transitivas, os testes de aceite dela e as entradas do IMPLEMENTATION-PACK dessas tarefas, e mostra a redução contra o PLAN.json e o pack inteiros. O teste exige ≥ 70% num plano de 30 tarefas.
- **Teste:** `tests/oxe-1212-workflow-budget.test.cjs`.
