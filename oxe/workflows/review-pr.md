# OXE — Workflow: review-pr (revisão de diff / PR)

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-verify`.
> Use: `/oxe-verify --pr` (branch atual) ou `/oxe-verify --diff branchA...branchB`.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Rever alterações como num pull request: **URL do GitHub** (`…/pull/<n>`), **branches** ou **SHAs**. Cobre diff, risco, convenções do projeto e sugestões acionáveis. **Não** substitui CI nem testes manuais; complementa-os.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-review.md`. A revisão deve ser findings-first, com severidade e evidência antes de qualquer resumo.
- **Base** e **head** são nomes de branch, tags ou SHAs (ex.: `main` e `feature/foo`).
- **URL de PR no GitHub** — O usuário pode colar o link (ex.: `https://github.com/org/repo/pull/10` ou atalho `org/repo#10`). O número da PR é o segmento depois de `/pull/`.
- Em Git, o diff “estilo PR” (só o que a branch introduz) usa o **merge base**: `git diff base...head` (três pontos).
- Diff literal entre pontas: `git diff base..head` (dois pontos) — útil quando o usuário pede explicitamente.
- Este passo é **opcional** no fluxo OXE; não atualiza `STATE.md` com fases canônicas, salvo se o usuário pedir registro do resultado em disco.
</context>

<process>
1. **Resolver entrada**
   - **URL ou `#` de PR** — Se a mensagem contiver URL `github.com/.../pull/<n>` (com ou sem `https://`, com sufixo `/files` ou `/commits`) ou texto `owner/repo#n`, extrair `<n>` (e opcionalmente `owner/repo` para confirmar que o clone local é o mesmo repositório).
   - **Refs explícitas** — Caso contrário, tratar como base/head: se faltar um dos dois, inferir base = `main` ou `master` (o que existir) e head = branch atual (`git rev-parse --abbrev-ref HEAD`), ou pedir clarificação.
2. **Obter diff (com URL / número de PR)** — Ordem de preferência quando o cwd é o repositório certo:
   - **GitHub CLI:** `gh pr diff <n>` (ou `gh pr diff <n> --patch`). Se `gh` não estiver disponível ou falhar auth, tentar Git puro.
   - **Git fetch ref da PR:** `git fetch origin pull/<n>/head:oxe-pr-<n>` (ajustar `origin` se o remoto tiver outro nome). Descobrir branch base com `gh pr view <n> --json baseRefName -q .baseRefName` ou assumir `main`/`master`; depois `git diff origin/<base>...oxe-pr-<n>` ou `git diff <base>...oxe-pr-<n>` após `fetch` da base.
   - **Sem terminal / outro repo:** Pedir ao usuário que cole o diff da aba “Files changed” no GitHub ou o output de `gh pr diff <n>` rodado localmente no repo certo.
3. **Obter diff (só branches / SHAs)** — Preferir terminal quando disponível:
   - `git fetch` (se fizer sentido e o ambiente permitir rede).
   - `git merge-base base head` (opcional, para confirmar ancestral comum).
   - `git diff base...head` (revisão tipo PR).
   - `git log base..head --oneline -n 30` (contexto de commits).
   Se o sandbox bloquear Git, pedir ao usuário que cole o output de `git diff base...head` ou use o diff da UI do GitHub/GitLab.
   Se o diff já foi obtido no passo 2 (URL da PR), **não** repetir este passo.
4. **Ler contexto do projeto** — Se existirem, usar trechos relevantes de `.oxe/codebase/CONVENTIONS.md`, `STACK.md`, `OVERVIEW.md` e, se aplicável, `.oxe/SPEC.md` / `.oxe/PLAN.md` para alinhar expectativas (sem assumir que o PR cobre só OXE).
5. **Analisar** — Estruturar a resposta com:
   - **Findings** — achados ordenados por severidade, com arquivo/área afetada e evidência.
   - **Arquivos / áreas** — Agrupar por domínio (API, UI, config, etc.).
   - **Riscos** — Regressões, breaking changes, segurança (inputs, segredos, auth), desempenho óbvio, migrações.
   - **Testes** — O que deveria ser coberto ou rodar localmente (comandos sugeridos se conhecidos do repo).
   - **Perguntas abertas** — pontos que impedem confiança alta na revisão.
   - **Resumo** — O que muda em 3–6 frases, apenas depois dos achados.
   - **Checklist PR** — Título sugerido, descrição curta, breaking changes, rollback.
6. **Opcional em disco** — Se o usuário pedir registro: criar ou atualizar **`.oxe/PR-REVIEW.md`** com data, URL ou refs (base/head), resumo, achados e próximos passos (Markdown legível).
</process>

<success_criteria>
- [ ] URL da PR ou par base/head está explícito na resposta (ou foi pedida clarificação).
- [ ] A análise baseia-se no diff (terminal ou colado), não só em suposições.
- [ ] Há seção de riscos e de testes/verificação sugerida.
- [ ] Nenhum segredo ou credencial é repetido na análise; redigir se aparecerem no diff.
- [ ] Se `.oxe/PR-REVIEW.md` foi criado (passo 6), a resposta menciona o caminho do artefato gerado.
</success_criteria>
