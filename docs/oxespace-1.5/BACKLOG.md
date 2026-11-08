# Backlog do oxe-build: validação pela OXESpace 1.5.0

Este backlog continua o de `docs/oxevoice/BACKLOG.md`: a numeração segue a partir do OXB-031. A fonte é a implementação de ponta a ponta da OXESpace 1.5.0 com o oxe-cc 1.21. São 8 fases, 60 tarefas e um time de agentes (TECH LEAD, BACKEND, FRONTEND, MOBILE, DESIGN, HML e SRE) trabalhando num repositório grande, com trem de merge e CI pesada.

Registro mantido pelo TECH LEAD do oxespace. Cada entrada traz evidência, impacto e uma proposta que vai além do conserto pontual. Os status possíveis são `aberto`, `em andamento`, `resolvido (<commit>)` e `proposta`.

O objetivo é duplo: evoluir o OXESpace e o oxe-build ao mesmo tempo.

---

## OXB-031: a versão 1.21 não está no npm, e cada time instala de um jeito

- **Status:** aberto.
- **Evidência (04/11):**
  - `npm view oxe-cc version` = 1.16.0;
  - global instalado = 1.12.0;
  - o 1.21.0 só existe no repositório local.
  - A instalação no oxespace foi feita com `node <oxe-build>/bin/oxe-cc.js install --oxe-only --local --dir <worktree>`.
- **Impacto:** cada agente do time precisa saber o caminho local. O `npx oxe-cc` de qualquer sessão roda uma versão velha sem programa por fases, e o doctor não avisa.
- **Proposta:** publicar a 1.21 (ou um canal `next`), e o `doctor` comparar a versão que gerou o `.oxe/` com a que está rodando, avisando no mismatch.

## OXB-032: o ROADMAP e a SPEC vivem em `.oxe/`, que o repositório não versiona

- **Status:** aberto.
- **Evidência:** o oxespace ignora `.oxe/` no `.gitignore`, como o próprio template sugere. O `program init` lê `.oxe/ROADMAP.md`. Para o time revisar o plano num PR, foi preciso copiar a SPEC e o ROADMAP para `docs/roadmap-1.5/oxe/` à mão, e cada edição exige recopiar (aconteceu 3 vezes no mesmo dia).
- **Impacto:** cópias divergem, e o PR revisado pode não ser o que o runtime executa.
- **Proposta:** um `roadmap_ref`/`spec_ref` no `config.json` apontando para caminhos versionados (ex.: `docs/roadmap-1.5/oxe/ROADMAP.md`), e o runtime lê de lá. Se for preciso manter a cópia em `.oxe/`, o `doctor` acusa a divergência por hash.

## OXB-033: as fases são estritamente seriais; um time com frentes paralelas fica parado

- **Status:** proposta.
- **Evidência:**
  - na 1.5.0, a F3 (worktrees, backend) não depende da F2 (Settings, frontend);
  - a F7 (modos) quase não depende de F4–F6.
  - Mesmo assim, o `program-model` só deixa começar uma fase depois de todas as anteriores fecharem.
- **Impacto:** com 5 papéis, a execução fica limitada ao ritmo da fase mais lenta, o que contraria a regra do time de "ninguém parado quando uma linha bloqueia".
- **Proposta:** dependência entre fases como DAG (`depends_on` por fase no ROADMAP), com fases independentes rodando em paralelo em worktrees separadas. O `program close` continua exigindo os gates de cada fase.

## OXB-034: editar o ROADMAP depois do `program start` exige `init --force`

- **Status:** aberto (risco a confirmar).
- **Evidência:** a revisão do coordenador acrescentou A40 e A41 à F8 com a F1 já iniciada. O caminho disponível foi `runtime program init --force`.
- **Impacto:** não está claro se o `--force` preserva o estado das fases já iniciadas ou fechadas. Se não preservar, uma emenda de escopo apaga o progresso.
- **Proposta:** um `runtime program amend` que aplica a emenda ao ROADMAP sem perder o estado. Nas fases fechadas, a emenda vira um CR `spec_gap` versionado em vez de sobrescrever.

## OXB-035: tarefas que o time já faz fora do executor não têm lugar no plano

- **Status:** aberto.
- **Evidência:** na F1, três tarefas são PRs que outros agentes já tinham em voo (pareamento, tela de falha do banco, S7.1). Outra (os tokens C4, PR #604) foi feita pelo FRONTEND antes de o PLAN.json existir. O `blocked_by` cobre "espere um PR externo", mas não "esta tarefa do plano foi entregue por outro caminho; verifique e marque como feita".
- **Impacto:** o plano ou duplica o trabalho ou mente sobre o que o executor fez.
- **Proposta:** `kind: external_delivery` com `pr: <repo#n>`. O verify roda os testes congelados contra a main depois do merge, e a tarefa fica `done` com `completed_by: external`, contando no scorecard à parte.

## OXB-036: decisões de orçamento mudam no meio do programa

- **Status:** proposta.
- **Evidência:**
  - o usuário aprovou um teto de US$ 275 por fases e, horas depois, removeu o teto ("o valor final é o produto funcional").
  - Hoje o orçamento vive em flags do `execute` ou no `budget` de cada PLAN.json.
- **Impacto:** é preciso editar cada PLAN.json, e o ledger não registra quem mudou a política nem quando.
- **Proposta:** `budget_policy` no `PROGRAM.json` (`cap` | `track_only`), com histórico de quem decidiu. No modo `track_only`, o scheduler mantém só a proteção contra laço (régua de suspeita + turnos máximos por tentativa) e o scorecard reporta o gasto.

## OXB-037: o critério A* da SPEC é grosso demais para a UI, e o OXE não tem subcritérios

- **Status:** proposta.
- **Evidência:** o DESIGN entregou critérios de aceite por tela (`team/plans/1.5.0-ui-acceptance.md`, com G1–G9 globais mais vários ACs observáveis por tela), organizados por onda de backend. A SPEC da 1.5.0 tem 41 A*, cada um cobrindo várias telas. O `idList` do program-model só reconhece `A<n>`, e o lint não tem como ligar um teste congelado a "A19, tela X, estado Y".
- **Impacto:** ou a SPEC cresce para centenas de A*, ou a ligação critério → teste fica implícita, e o OXB-030 (termo do critério que o teste não exercita) volta pela porta da UI.
- **Proposta:** subcritérios `A19.3` na SPEC, aceitos pelo parser, pelo lint (cobertura por subcritério) e pelo dossiê (techspec por subcritério). Junto, critérios globais (`G*`) que valem para toda tarefa de UI da fase, como contraste, teclado e 900 px.

## OXB-038: qualquer `A<n>` em texto vira critério da SPEC (colisão de namespace)

- **Status:** aberto.
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

- **Status:** proposta.
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

- **Status:** aberto.
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

- **Status:** aberto (erro de planejamento mais falta de enforcement).
- **Evidência:** a F1-T5 (ícones) passou no teste congelado: um módulo por ícone, `currentColor`, `aria-hidden`. A revisão do DESIGN mostrou que 4 ícones eram cópias do Lucide sem as marcas do Mandacaru, e que o History era o relógio, não o scrubber aprovado. O desenho aprovado estava em `playground/src/components/icons.ts`, mas a âncora RA-01 apontava para o HANDOFF, não para esse arquivo, e o teste não comparava geometria.
- **Impacto:** um "verde" que não é o produto aprovado. Foi preciso o CR-02, com um teste que compara as formas desenhadas com o arquivo aprovado.
- **Proposta:** uma âncora com `action: copy` vira check automático no verify: os símbolos e trechos copiados precisam bater com a fonte (hash ou geometria). O lint também avisa quando uma tarefa de UI com `VISUAL-INPUTS` crítico não tem teste que compare saída com a fonte visual.

## OXB-050: dentro de uma onda, as tarefas que escrevem rodam em série, e o modo paralelo não prepara dependências

- **Status:** aberto (levantado pelo coordenador, a partir da pergunta do usuário sobre por que só havia um processo rodando).
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
