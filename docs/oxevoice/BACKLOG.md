# Backlog do oxe-build: validação pelo OxeVoice

Construímos o **OxeVoice 1.5** (voz nativa cross-OS no oxespace) usando o oxe-build de ponta a ponta, no fluxo recomendado pelo manual:

```text
/oxe-spec → runtime program init/start → /oxe-plan (PLAN.json + aceite congelado) → plan lint
          → runtime execute (claude -p) → runtime verify → runtime program close
```

Todo problema que aparece no caminho vira uma entrada aqui. Cada entrada tem a evidência, o impacto e uma proposta que vai além do conserto pontual. Não basta remover o sintoma: a pergunta é o que o fluxo deveria ser.

Status possíveis: `aberto`, `em andamento`, `resolvido (<commit>)`, `proposta`.

---

## OXB-001: o executor escrevia o próprio teste de aceite (falso verde)

- **Status:** resolvido (1.19, aceite congelado).
- **Evidência:** e2e real `e2e-program --real` de 2026-10-31.
  - O executor entendeu "createApi devolve handle" como `{ handle }` e escreveu um teste que concordava com essa leitura.
  - O verify deu verde, e o oráculo independente reprovou a F2.
- **Correção:** `PLAN.json.acceptance_tests`.
  - O teste é escrito no `/oxe-plan` e tem o hash congelado no compile.
  - Vai para o prompt como SPEC executável, e o executor tem a escrita negada.
  - O verify reprova com `acceptance_tampered` ou `acceptance_missing`.
  - `e2e-program` ganhou os cenários `misread-interface` e `tampered-acceptance`.
- **Fora da caixa:**
  - Separar os papéis **autor do aceite** e **implementador**, com agentes e modelos diferentes. O aceite pode ser gerado por um "adversarial spec agent" que tenta quebrar as interpretações ambíguas da SPEC antes do plano fechar.
  - Medir **ambiguidade da SPEC**: quantas leituras distintas N agentes produzem para o mesmo A*. Um A* com divergência alta bloqueia o plano até ser esclarecido.

## OXB-002: `writeRunState` descartava campos sem avisar

- **Status:** resolvido (1.19).
- **Evidência:** `acceptance_lock` e `verification_regression` sumiam da run, porque a função grava só uma lista fixa de campos. O lock nunca era persistido, e o teste de mutação do aceite fechava a fase.
- **Fora da caixa:** dar à run state um schema versionado e validado (o mesmo validador do PLAN.json), com teste de round-trip. Campo desconhecido vira erro em dev e aviso em produção, nunca perda silenciosa.

## OXB-003: comandos do runtime recriam arquivos `.oxe/` que o usuário apagou

- **Status:** aberto.
- **Evidência:** `runtime providers` na raiz do repo recriou o `.oxe/STATE.md` a partir do template.
- **Fora da caixa:** comandos de leitura nunca escrevem. Separar `runtime` em leitura (puro) e escrita (com journal), e escrever só no que o comando declara como efeito colateral.

## OXB-004: `runtime verify --json` emite o banner antes do JSON

- **Status:** aberto.
- **Evidência:** a saída não é JSON válido, então os benchmarks leem a run do disco.
- **Fora da caixa:** toda saída `--json` vira contrato versionado (`oxe*Schema`), testado por um snapshot de schema no CI. O banner vai para stderr.

## OXB-005: sem gate humano por tarefa nem execução parcial por onda

- **Status:** resolvido (1.20c). O `PLAN.json` aceita `gate: {kind, reason}` e `blocked_by: ["oxespace#B21"]` por tarefa: o scheduler para antes dela com `GateRequested`, e as outras tarefas seguem.
- **Evidência:** na F1 do OxeVoice, o wiring dos hot files (de outras equipes) depende de um ASK ao coordenador e do merge do B21. O `runtime execute` roda todas as ondas, e `requires_human_approval` é global (`graph-compiler.ts`).
- **Contorno:** a T7 virou "proposta de diff" (`docs/voice/HOTFILES-PROPOSAL.md`), e a aplicação entra por `/oxe-plan --replan` depois do ASK.
- **Fora da caixa:**
  - `PLAN.json` com `gate: { kind: 'human'|'external', reason, until? }` por tarefa, em que o scheduler para antes dela e emite `GateRequested`;
  - **dependências externas declarativas** (`blocked_by: ["oxespace#B21"]`), consultadas no GitHub/CI; a tarefa destrava quando o PR externo entra.

## OXB-006: o ambiente do projeto não faz parte do preflight

- **Status:** aberto.
- **Evidência:** no worktree do oxespace, o `npm ci` com o Node 22.17/npm 10.9 da máquina rodou `node-gyp rebuild` no `better-sqlite3` 13, mesmo com `gypfile:false` e prebuilds. Falhou, e o pacote foi removido em silêncio como "optional failed". As dependências pedem Node `^22.22.2 || ^24.15`. A causa só apareceu no verify nativo.
- **Fora da caixa:** um `oxe-cc doctor --project` que lê `engines`, `.nvmrc`, `packageManager` e o lockfile, compara com a máquina e bloqueia o `execute` com um diagnóstico acionável. Um `environment` no PROGRAM.json fixa o toolchain por fase, e a evidência do verify registra a versão usada.

## OXB-007: o gate de confiança não tem um caminho de "spike" no fluxo

- **Status:** aberto.
- **Evidência:** o preflight bloqueou o execute com `plan_confidence:88%<=90%`, e com razão: a incerteza era se o PowerShell 5.1 consegue escutar eventos WinRT.
  - O spike manual respondeu que **não consegue** (`Register-ObjectEvent` → "não pode assinar eventos Windows RT").
  - Ele também confirmou o mapeamento do 0x80045509.
  - O plano mudou (loop de `RecognizeAsync`, sem parciais) e foi para 91% com evidência.
  - Sem o spike, o executor teria descoberto isso no meio da T4, com custo pago e retries.
- **Fora da caixa:** o gate de confiança gera **tarefas de spike** automáticas.
  - Cada "principal incerteza" do plano vira uma tarefa `read_code`/`collect_evidence` com orçamento pequeno e uma pergunta binária.
  - O resultado (`SPIKE-<n>.json`, com a evidência) recalcula a confiança e atualiza o PLAN por replan antes da onda 1.
  - A confiança deixa de ser um número declarado e passa a ser **derivada das incertezas que restam abertas**.

## OXB-008: o blocker de confiança dizia "91%<=90%"

- **Status:** resolvido (mensagem). O preflight agora diz `plan_self_evaluation_incomplete:<n> — <avisos>` quando o percentual passa do limiar mas a rubrica, o vetor ou as alternativas estão incompletos.
- **Fora da caixa:** o `/oxe-plan` gera a rubrica, o vetor e as âncoras a partir do PLAN.json (são dados, não prosa). O `plan lint` aponta o que falta antes do preflight, e o markdown vira apenas projeção.

## OXB-009: um comando de verificação quebrado no plano custava retries pagos

- **Status:** resolvido (`oxe-cc plan lint --dry-verify`).
- **Evidência:** o verify da T1 da F1 (esbuild com 2 entradas e sem `outdir`) reprovou 3 tentativas do executor com código correto: 13 turnos, US$ 0,75, tudo jogado fora. O retry não distingue "o código está errado" de "a régua está errada".
- **Correção:** antes de executar, cada verify roda uma vez e precisa ficar **vermelho pelo motivo certo**, isto é, falhar porque o alvo da tarefa ainda não existe.
  - Um comando quebrado é erro de lint.
  - Um verify que já passa vira aviso, porque não prova nada.
- **Fora da caixa:**
  - Um retry com **diagnóstico da régua**: quando a mesma falha se repete com saída idêntica entre tentativas, o runtime para e classifica (`verify_command_suspect`) em vez de pagar a próxima tentativa.
  - O executor pode apresentar uma objeção estruturada ao verify ("o comando falha por X, não pelo meu código"), e ela vira um gate para o planner.

## OXB-010: o `recover` não reconhece um journal `running` deixado por um processo morto

- **Status:** resolvido (1.20c). O journal tem lease (`owner_pid` + `heartbeat_at`). Um `running` com dono morto, sem dono ou com heartbeat de mais de 6 h vira `interrupted`, que é retomável e preserva o que foi concluído.
- **Evidência:** depois do OOM, o `runtime recover` informou `Journal: running` e só deixou a run em `planned`, sem reconciliar a tentativa interrompida.
- **Fora da caixa:** um lease com heartbeat no journal. Um journal `running` cujo PID não existe mais ou cujo heartbeat venceu vira `interrupted`, e o recover retoma da tarefa interrompida, com o custo das tentativas anteriores preservado.

## OXB-011: falso verde num critério UAT e suíte em cache com regras velhas

- **Status:** resolvido.
- **Evidência:** no verify da F1, o `check-a8` ("ditado real no Windows", UAT manual) **passou** usando o verify da T7, que só confere se o documento de UAT existe.
  - Depois da correção, a suíte persistida continuou com a regra antiga, porque o cache era indexado só pelos hashes de SPEC/PLAN.
  - No mesmo verify, `check-pack-t5` reprovou com `oxe_internal_reference` por uma menção a `.oxe/` que já existia no `origin/main` (o oxespace integra o OXE).
- **Correção:**
  - um critério declarado `manual`/`UAT`/homologação sem comando próprio vira check `manual` (nunca é "provado" pelo comando de uma tarefa);
  - `VERIFICATION_COMPILER_VERSION` entra no `plan_hash` da suíte;
  - `oxe_internal_reference` só conta referências **novas** em relação ao `HEAD`.
  - Agora a F1 fica `blocked`, com 22/23 verdes e o A8 pendente de UAT, que é o estado correto.
- **Fora da caixa:** o critério UAT exige **sign-off humano** registrado (quem, quando, evidência) para a fase fechar (1.20b).

---

## Melhorias de fluxo em observação durante o OxeVoice

Hipóteses a confirmar com dados das fases:

- **Custo e turnos por fase:** o coordenador do oxespace pede um ASK quando uma fase passa de 2× os turnos planejados. Proposta: o PLAN.json declara `budget.turns` por tarefa, o runtime aplica o limite e emite `BudgetExceeded`, que vira gate humano.
- **Coordenação multi-time:** o oxespace tem "hot files" disputados por outras equipes. Proposta: o PLAN.json declara `contested_paths`, o scheduler serializa as tarefas que tocam esses arquivos e o `program close` exige um ASK registrado antes do PR.
- **Validação cross-OS:** voz nativa depende do SO. Proposta: um verify por matriz (`runs_on: [windows, macos, linux]`) delegado ao CI, em que a fase só fecha com evidência das 3 plataformas.

## OXB-012: flags da CLI no parser errado, sem teste pela linha de comando

- **Status:** resolvido.
- **Evidência:** as flags de `runtime program/dossier/signoff/feedback` (1.19–1.20) foram inseridas no `parseContextArgs`, e não no `parseRuntimeArgs`. Os testes chamavam o operational direto, e o e2e também, então nada falhou.
  - Pela CLI real, `feedback --class` dava "Opção desconhecida".
  - O `feedback <dir>` tratava o diretório como subcomando e gravou um CR no `.oxe` do repositório errado.
- **Correção:** as flags foram movidas para o parser certo, só `list` é subcomando do `feedback`, e o `tests/oxe-runtime-program-cli.test.cjs` exercita os comandos pela CLI de verdade.
- **Fora da caixa:** um teste gerado a partir da tabela de uso (`usage()`): todo comando e flag documentado é chamado pela CLI num projeto temporário, então documentação e parser não divergem.

## OXB-013: o retry era cego (o executor nunca via por que o verify falhou)

- **Status:** resolvido (1.20c).
- **Evidência:** na F1, a T1 falhou 3 vezes no verify. Cada nova tentativa recebeu só "Verification failed: checks did not pass", e o executor nunca viu o erro do esbuild.
- **Correção:**
  - **Retry informado:** a próxima tentativa recebe o comando, o motivo e as últimas 40 linhas da saída, mais a instrução de parar e explicar se o próprio comando estiver errado.
  - **Régua suspeita:** a mesma falha, com saída normalizada (sem tempos, timestamps, hashes e caminhos temporários), em duas tentativas faz a tarefa parar com `verify_suspect` e emite `VerifyCommandSuspect`, sem pagar as tentativas restantes.
  - **Checkpoint por tarefa** (`--checkpoint-commits` ou `checkpoint_commits`): commit local só do escopo da tarefa concluída.
  - `runtime rollback --task Tn [--yes]` devolve o escopo ao último checkpoint (dry-run por padrão).

## OXB-014: CR de `constraint` sem critério não tinha como ser provado

- **Status:** resolvido.
- **Evidência:** o CR-03 do OxeVoice ("eslint react-hooks/refs com zero warnings") não pertence a nenhum A*. Como o teste de aceite congelado exigia `criterion` e gerava um check por critério, o CR nunca poderia fechar por evidência.
- **Correção:** a entrada `acceptance_tests[]` pode ter um `id` próprio (check `check-accept-<id>`). O `criterion` passa a ser opcional quando há `id` + `resolves`. O lock, o reconcile do CR e o schema usam `id || criterion`.

## OXB-015: num replan, tarefas concluídas disputavam escopo com as novas

- **Status:** resolvido. O lint ignora as tarefas `done` na checagem de escopo e de onda, porque elas não rodam de novo.

## OXB-016: o dry-verify não reconhecia o vermelho certo de uma tarefa de correção

- **Status:** resolvido. Quando os alvos já existem (correção, não criação), uma falha de asserção do runner é `assertion_red`, que é vermelho pelo motivo certo. Erros de ferramenta continuam sendo `broken_command`.

## OXB-017: o replan reexecutava as tarefas concluídas

- **Status:** resolvido. A opção `skip_done_tasks` existia, mas vinha desligada por padrão. Agora o compile a partir do PLAN.json pula as tarefas `done`, e as dependências nelas contam como satisfeitas. Sem isso, o rework da F1 pagaria de novo por T1–T7.
