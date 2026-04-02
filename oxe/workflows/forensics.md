# OXE — Workflow: forensics

<objective>
Diagnosticar **incidentes de fluxo** após falha ou incoerência entre artefatos `.oxe/`, Git e saída de `oxe-cc doctor`: produzir **`.oxe/FORENSICS.md`** com linha do tempo, hipótese de causa e **exatamente um** próximo passo canónico OXE (`scan`, `plan` ou `execute` — incluindo ações como reinstalar workflows ou correr verify como parte do movimento **execute**).

Não reescrever `SPEC.md` nem apagar `PLAN.md`; apenas **recomendar** o reingresso na trilha.
</objective>

<context>
- Usar quando: `VERIFY.md` com falhas ou gaps não explicados, `oxe-cc doctor` com **FALHA**, `STATE.md` contradiz ficheiros presentes (ex.: “onda concluída” sem `VERIFY.md`), ou o utilizador indica estar **preso** após várias tentativas de replan.
- Ler: `.oxe/STATE.md`, `.oxe/VERIFY.md` (se existir), `.oxe/PLAN.md`, `.oxe/SPEC.md` (se existir), `.oxe/QUICK.md` (se existir).
- Opcional: resumo de `git log --oneline -n 15` e `git status` (ou equivalente fornecido pelo utilizador).
- Opcional: saída resumida de `npx oxe-cc doctor` no diretório do projeto.
</context>

<process>
1. Confirmar diretório raiz do projeto e existência de `.oxe/`.
2. Recolher evidência: STATE, VERIFY, PLAN, SPEC, QUICK (trechos relevantes), Git, doctor.
3. Redigir **`.oxe/FORENSICS.md`** com secções fixas:
   - **Data** (ISO) e **Sintoma** (1–3 frases).
   - **Linha do tempo** — bullets curtos (o que se tentou, ordem aproximada).
   - **Hipótese de causa** — uma ou duas hipóteses ranqueadas (ex.: plano desalinhado, mapa desatualizado, workflows em falta, implementação incompleta).
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
