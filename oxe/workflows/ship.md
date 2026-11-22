# OXE — Workflow: ship (entregar)

<objective>
Levar o trabalho verificado até produção, um passo verde por vez: **PR → CI → merge → deploy → docs → fechar o ciclo** (com programa por fases, fechar a fase). Cada passo só avança quando o anterior está verde; quando não está, pare e explique o que falta.

`--local` mantém o comportamento antigo: um commit local com a mensagem gerada de SPEC, PLAN e VERIFY.
`--defect "…"` registra um defeito encontrado depois da entrega.
</objective>

<flags>
- `--local` — só o commit local (Passo L). Admite também `--message "…"`, `--amend`, `--dry-run` e `--no-checks`.
- `--defect "título" --origin US-n|Fn-Tn` — defeito depois do deploy (Passo X).
- `--env <ambiente>` — ambiente do deploy (padrão: `delivery.deploy_env` do config).
- `--verify-first` — rodar `/oxe-verify` antes, se o verify ainda não passou.
</flags>

<context>
- O estado da entrega vem de `oxe-cc ship status --json`: PRs abertos e com merge, deploys anexados e o próximo passo. Releia depois de cada passo.
- O modo vem do config: `delivery: { "mode": "pr", "deploy_env": "staging" }` ou `delivery: { "mode": "local" }`. Sem `delivery.mode: "pr"`, o motor trata como local (commit local, Passo L). Sem a chave `delivery`, pergunte uma vez no Passo 0.
- Com programa (`.oxe/program/PROGRAM.json`), o ciclo fecha em `oxe-cc runtime program close`. Sem programa (quick ou spec de fase única), **não** rode `program close` (ele falha sem programa): o ciclo fecha depois do merge, do deploy anexado (quando houver) e dos docs.
- O OXE **nunca** faz deploy, tag, release ou publicação: isso fica com quem é dono. Ele abre o PR, acompanha e registra as evidências.
- Com ALM configurado, a chave do item vai no título do PR, nos commits e no branch, e os itens andam sozinhos (PR → em revisão, merge, deploy → lançado). Com `alm.transport: "mcp"`, rode `oxe-cc alm queue` depois de cada passo.
- Comandos que mudam o remoto (push, abrir PR, merge) só com o OK explícito do usuário.
</context>

<process>

### Passo 0 — Pré-voo
1. `oxe-cc ship status --json`. Sem fase verificada (verify verde), pare e indique `/oxe-verify` (ou rode-o com `--verify-first`).
1a. **Modo de entrega (primeira entrega sem `delivery` no `.oxe/config.json`):** pergunte uma vez, com a recomendada. Recomende **PR** quando `git remote get-url origin` aponta para o GitHub e `gh auth status` passa; senão recomende **local**. Pergunte também o ambiente de deploy, se houver (vira `deploy_env`). Grave a resposta em `.oxe/config.json`: `"delivery": { "mode": "pr", "deploy_env": "<env>" }` (sem `deploy_env` quando não houver ambiente) ou `"delivery": { "mode": "local" }`. Não pergunte de novo nas próximas entregas; `--local` numa entrega não muda o config.
2. Critérios manuais pendentes → `oxe-cc runtime signoff --criteria A<n> --by <quem> --evidence …`. Dossiê da fase → `oxe-cc runtime dossier`.
3. `git status --short`: mudança fora do escopo do plano para a entrega e vira pergunta ao usuário.

### Passo 1 — PR
- Para cada tarefa de um plano (`PLAN.json`) a promover: `oxe-cc runtime promote T<n> --base main --open-pr`. O título leva a chave do ALM, e o PR roda as checagens de integração.
- Para entregar um **`/oxe-quick`** (sem `PLAN.json`): `oxe-cc quick promote --open-pr` (use `--dry-run` para revisar antes; base: `--base <branch>`, `delivery.base` ou o padrão do remoto; numa branch ≠ base). O PR do quick segue o Passo 2 (CI e merge em `oxe-cc ship status`) antes de fechar. Ele roda `ship check-origin`, faz push da branch atual e abre o PR já com `Fecha <KEY>` (quando houver card ALM) e o resumo de verificação no corpo.
- Mostre a URL. A falha de promoção vem com o motivo: corrija e promova de novo; não force.

### Passo 2 — CI e merge
- Rode `oxe-cc ship status` até o PR aparecer com merge. Ele classifica o CI de cada PR:
  - **falha conhecida:** o teste bate com `oxe-cc ship known-failure add "<teste>" --item <chave>` e o item segue aberto. Rode a sugestão (`gh run rerun <id> --failed`); não é regressão.
  - **vermelho:** leia o log (`gh run view <id> --log-failed`) e volte ao `/oxe-execute --debug` com o motivo.
  - Não faça merge com CI vermelho. Registre a falha conhecida com `--pr <n do conserto>`: ela fica no repositório (todas as worktrees) e expira sozinha quando esse PR é mergeado (`oxe-cc ship known-failure prune`).
- PR fora de fase, de um card ou o repositório inteiro: `oxe-cc ship status --pr <n>` · `--card <KEY>` · `--repo` (com os rótulos do trem); `--comment --apply` põe o veredito no PR, onde o trem e a CI leem.
- Antes do merge: `oxe-cc ship check-origin <#PR>`. Todo commit vem do `runtime execute` (`OXE-Task`) ou de um quick registrado (`OXE-Quick`); as isenções são só as de `origin.exempt`.
- O merge é do usuário ou do trem de merge do repositório. O OXE detecta o merge (`gh pr view`) e registra.
- Fase com CI exigido no close: `oxe-cc runtime ci --attach <run> --head <sha>`.

### Passo 3 — Deploy
- Depois do merge, e quando houver ambiente: `oxe-cc runtime deploy --attach <env> --version <v> --ref <tag|url> --check "<smoke>"`. Isso só registra e roda as checagens pós-deploy; o deploy em si é de quem é dono.

### Passo 4 — Documentos e fechamento
1. Com `docs_publish` configurado: `oxe-cc docs publish` (PRD, RFCs, ADRs, glossário, SYSTEM-DESIGN).
2. **Com programa:** `oxe-cc runtime program close`: regressão congelada, contratos e commit da fase (exige `--by <papel> --reason "…"` quando combinado com `--by-ci`, `--no-rollback-check` ou `--accept-drift`). Num branch com PR aberto, o close não commita (use um branch separado ou `--force-branch`).
   **Sem programa:** não há `program close`. Com o merge registrado (e o deploy anexado, quando houver ambiente), o ciclo está fechado; atualize `STATE.md` com a entrega (PR, merge, deploy).
3. Com ALM: `oxe-cc alm sync --apply`, que leva os itens a "lançado".

### Passo X — Defeito depois da entrega (`--defect`)
1. Pergunte a reprodução, o impacto e o critério ou a história de origem (uma pergunta por vez, com a recomendada).
1a. **Rode a suíte antes de afirmar qualquer cobertura** (`npm test` ou o Verificar das tarefas de origem) e cite o resultado. No bench (B58), o agente disse "os testes não cobrem" com 3 testes vermelhos na suíte. Use `oxe-cc`, nunca o `npx oxe-cc` sem versão.
2. `oxe-cc alm defect --title "…" --origin <US-n|Fn-Tn> --apply` (com ALM) e `oxe-cc runtime feedback --class defect --summary "…" --criteria A<n> --tasks T<n> --reopen` (sem `--reopen`, apenas vincula a tarefa sem reabri-la para o próximo `/oxe-execute`).
3. O próximo passo é `/oxe-plan --replan`, para cobrir o CR com teste de aceite na fase atual ou numa fase nova (ver `references/change-management.md`). Para um defeito pequeno dentro de um critério que já existe, o replan cobre só o delta: um teste que **reproduz** o defeito (vermelho primeiro, com `"resolves": ["CR-…"]`), a tarefa de correção, depois execute e verify. Nunca deixe o defeito sem CR e sem teste.

### Passo L — Commit local (`--local`)
1. Verify aprovado, ou `--no-checks` com aviso explícito.
1a. **Com plano (`PLAN.json`):** o código entra por tarefa, nunca num commit único sem trailer. Para cada tarefa ainda sem `done` no `PLAN.json`, rode `oxe-cc runtime commit-task T<n>` (verifica, commita com `OXE-Task` e marca done). Só o que sobrar fora das tarefas (docs, CHANGELOG) segue para o passo 2. Com tudo já commitado por tarefa, pule para o passo 4.
2. Gerar a mensagem de commit a partir de SPEC ou QUICK (objetivo), PLAN (tarefas) e VERIFY (validação): `feat|fix|refactor: <≤ 72 chars>`, com a chave do ALM quando houver (`feat: … (OXE-12)`). Salvar em `.oxe/commit-draft.md`.
3. `git add` do escopo planejado (pare e confirme se houver arquivo fora dele) e `git commit -F .oxe/commit-draft.md`, ou `--amend`.
4. Registrar SHA, assunto, branch e status do verify em `.oxe/commit-record.json`. Com `--dry-run`, só mostre a mensagem e o comando.
5. Falha de hook ou conflito: mantenha o rascunho e mostre o comando que falhou.
6. **Com programa:** feche a fase aqui — `oxe-cc runtime program close` (sign-offs pendentes e drift aparecem na saída; trate-os e rode de novo). Sem programa, o ciclo fecha no commit. Não mande o usuário de volta para `/oxe-verify` se o verify já está verde: se o `program close` disser "verify não concluído", siga o comando que ele indica (normalmente `runtime commit-task T<n>`).
</process>

<success_criteria>
- [ ] Cada passo avançou só com o anterior verde, e a pergunta ao usuário veio antes de qualquer push, PR ou merge.
- [ ] PR com a chave do ALM (quando houver), CI verde, merge registrado e deploy anexado com as checagens.
- [ ] Modo de entrega perguntado uma vez e gravado em `delivery` no `.oxe/config.json` (quando faltava).
- [ ] Com programa, a fase foi fechada (`program close`); sem programa, o ciclo fechou após merge/deploy/docs sem `program close`. Docs publicados quando configurados e itens do ALM em "lançado".
- [ ] `--defect`: item no ALM ligado à origem e CR aberto; próximo passo é `/oxe-plan --replan`.
- [ ] Terminou com o **Próximo passo** de `oxe-cc status --json` (ver `references/next-step-footer.md`).
</success_criteria>
