# OXE — Workflow: forensics

<objective>
Diagnosticar **incidentes de fluxo** após falha ou incoerência entre artefatos `.oxe/`, Git e saída de `oxe-cc doctor`: produzir **`.oxe/FORENSICS.md`** com linha do tempo, hipótese de causa e **exatamente um** próximo passo canónico OXE (`scan`, `plan` ou `execute` — incluindo ações como reinstalar workflows ou correr verify como parte do movimento **execute**).

Não reescrever `SPEC.md` nem apagar `PLAN.md`; apenas **recomendar** o reingresso na trilha.
</objective>

<context>
- Usar quando: `VERIFY.md` com falhas ou gaps não explicados, `oxe-cc doctor` com **FALHA**, `STATE.md` contradiz ficheiros presentes (ex.: “onda concluída” sem `VERIFY.md`), ou o utilizador indica estar **preso** após várias tentativas de replan.
- Ler: `.oxe/STATE.md`, `.oxe/VERIFY.md` (se existir), `.oxe/PLAN.md`, `.oxe/SPEC.md` (se existir), `.oxe/QUICK.md` (se existir).
- **Git é opcional:** em sandbox sem Git ou sem permissão de terminal, **não** falhar o workflow; registar em `FORENSICS.md` que Git não foi avaliado.
- Opcional: saída resumida de `npx oxe-cc doctor` no diretório do projeto.
- Se o sintoma for **mapa OXE desatualizado** (ex.: `STACK.md` / estrutura em `.oxe/codebase/` claramente atrás do repo) sem workflows em falta, a **Hipótese de causa** ou a **Justificativa** pode mencionar **`/oxe-compact`** como ação complementar **depois** de escolhido o passo canónico — o próximo passo OXE recomendado continua a ser **um** entre `scan` | `plan` | `execute`.

**Git (opcional)** — se o agente puder correr terminal **ou** o utilizador colar saída, preferir recolher:

- `git log --oneline -n 30`
- `git log --format="%H %ai %s" -n 15` (datas para **Linha do tempo**)
- `git log --name-only --format="" -n 20 | sort | uniq -c | sort -rn | head -20` (ficheiros mais alterados — indica foco ou “loop” de edições)
- `git status --short`
- Opcional: `git diff --stat` (se relevante ao sintoma)
</context>

<process>
1. Confirmar diretório raiz do projeto e existência de `.oxe/`.
2. Recolher evidência: STATE, VERIFY, PLAN, SPEC, QUICK (trechos relevantes), saída de **doctor** se disponível, e **Git (opcional)** conforme bloco no context (se indisponível, seguir sem Git).
3. Redigir **`.oxe/FORENSICS.md`** com secções fixas:
   - **Data** (ISO) e **Sintoma** (1–3 frases).
   - **Linha do tempo** — bullets curtos (o que se tentou, ordem aproximada); **incorporar** commits/datas e ficheiros mais tocados quando houver evidência Git; se Git não foi avaliado, linha explícita: *Git não avaliado (ambiente/indisponível)*.
   - **Hipótese de causa** — uma ou duas hipóteses ranqueadas (ex.: plano desalinhado, mapa desatualizado, workflows em falta, implementação incompleta); usar padrões Git (ficheiros repetidos, working tree suja) quando útil.
   - **Próximo passo OXE recomendado:** **um único** valor entre `scan` | `plan` | `execute` e o **comando** correspondente (`/oxe-scan`, `/oxe-plan`, `/oxe-execute` ou `npx oxe-cc@latest` / `npx oxe-cc doctor` quando a causa for tooling).
   - **Justificativa** — uma frase que liga evidência ao passo escolhido.
4. Atualizar **`.oxe/STATE.md`** com uma linha opcional sob decisões ou contexto: referência a `FORENSICS.md` e fase sugerida (ex.: `forensics_complete` → próximo conforme passo recomendado).
5. Responder no chat em ≤8 linhas: resumo do diagnóstico e **só** o próximo passo (sem lista equiparável de alternativas).
</process>

<success_criteria>
- [ ] `.oxe/FORENSICS.md` existe com **Próximo passo OXE recomendado** igual a **um** entre `scan`, `plan`, `execute`.
- [ ] Não há conclusão “feito” sem indicar reingresso na trilha canónica.
- [ ] `SPEC.md` / `PLAN.md` não foram apagados nem substituídos sem ação explícita do utilizador.
</success_criteria>
