# OXE — Workflow: ship (entregar)

<objective>
Levar o trabalho verificado até produção, um passo verde por vez: **PR → CI → merge → deploy → docs → fechar a fase**. Cada passo só avança quando o anterior está verde; quando não está, pare e explique o que falta.

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
- O modo vem do config: `delivery: { "mode": "pr", "deploy_env": "staging" }`. Sem `delivery.mode: "pr"`, a entrega padrão é o close com commit local; nesse caso, use `--local` ou siga para `oxe-cc runtime program close`.
- O OXE **nunca** faz deploy, tag, release ou publicação: isso fica com quem é dono. Ele abre o PR, acompanha e registra as evidências.
- Com ALM configurado, a chave do item vai no título do PR, nos commits e no branch, e os itens andam sozinhos (PR → em revisão, merge, deploy → lançado). Com `alm.transport: "mcp"`, rode `oxe-cc alm queue` depois de cada passo.
- Comandos que mudam o remoto (push, abrir PR, merge) só com o OK explícito do usuário.
</context>

<process>

### Passo 0 — Pré-voo
1. `oxe-cc ship status --json`. Sem fase verificada (verify verde), pare e indique `/oxe-verify` (ou rode-o com `--verify-first`).
2. Critérios manuais pendentes → `oxe-cc runtime signoff --criteria A<n> --by <quem> --evidence …`. Dossiê da fase → `oxe-cc runtime dossier`.
3. `git status --short`: mudança fora do escopo do plano para a entrega e vira pergunta ao usuário.

### Passo 1 — PR
- Para cada tarefa a promover: `oxe-cc runtime promote T<n> --base main --open-pr`. O título leva a chave do ALM, e o PR roda as checagens de integração.
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
2. `oxe-cc runtime program close`: regressão congelada, contratos e commit da fase. Num branch com PR aberto, o close não commita (use um branch separado ou `--force-branch`).
3. Com ALM: `oxe-cc alm sync --apply`, que leva os itens a "lançado".

### Passo X — Defeito depois da entrega (`--defect`)
1. Pergunte a reprodução, o impacto e o critério ou a história de origem (uma pergunta por vez, com a recomendada).
2. `oxe-cc alm defect --title "…" --origin <US-n|Fn-Tn> --apply` (com ALM) e `oxe-cc runtime feedback --class defect --summary "…" --criteria A<n>`.
3. O próximo passo é `/oxe-plan --replan`, para cobrir o CR com teste de aceite na fase atual ou numa fase nova (ver `references/change-management.md`).

### Passo L — Commit local (`--local`)
1. Verify aprovado, ou `--no-checks` com aviso explícito.
2. Gerar a mensagem de commit a partir de SPEC ou QUICK (objetivo), PLAN (tarefas) e VERIFY (validação): `feat|fix|refactor: <≤ 72 chars>`, com a chave do ALM quando houver (`feat: … (OXE-12)`). Salvar em `.oxe/commit-draft.md`.
3. `git add` do escopo planejado (pare e confirme se houver arquivo fora dele) e `git commit -F .oxe/commit-draft.md`, ou `--amend`.
4. Registrar SHA, assunto, branch e status do verify em `.oxe/commit-record.json`. Com `--dry-run`, só mostre a mensagem e o comando.
5. Falha de hook ou conflito: mantenha o rascunho e mostre o comando que falhou.
</process>

<success_criteria>
- [ ] Cada passo avançou só com o anterior verde, e a pergunta ao usuário veio antes de qualquer push, PR ou merge.
- [ ] PR com a chave do ALM (quando houver), CI verde, merge registrado e deploy anexado com as checagens.
- [ ] A fase foi fechada (`program close`), os docs foram publicados quando configurados e os itens do ALM estão em "lançado".
- [ ] `--defect`: item no ALM ligado à origem e CR aberto; próximo passo é `/oxe-plan --replan`.
- [ ] Terminou com o **Próximo passo** de `oxe-cc status --json` (ver `references/next-step-footer.md`).
</success_criteria>
