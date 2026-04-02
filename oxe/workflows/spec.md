# OXE — Workflow: spec

<objective>
Registrar a intenção do usuário em **`.oxe/SPEC.md`**: escopo, **critérios de aceite com IDs estáveis (A1, A2, …)** e coluna **Como verificar**, não objetivos e suposições. A spec é o contrato antes do plano.

Para trabalho **muito pequeno**, o usuário pode preferir **`oxe:quick`** (`.oxe/QUICK.md`) em vez deste fluxo — não bloqueie: se pedirem explicitamente quick, redirecione.

Se **`.oxe/config.json`** tiver `discuss_before_plan: true`, mencionar no fim que o próximo passo recomendado é **`oxe:discuss`** antes do plano.

Entrada: texto livre na mensagem ou caminho `@arquivo.md` / anexo para incorporar PRD/notas.
</objective>

<context>
**Pré-requisito:** preferencialmente **scan** já executado. Se não existir scan, mencionar na spec que o mapa está pendente.

Leia `.oxe/STATE.md` e, se existirem, trechos relevantes de `.oxe/codebase/OVERVIEW.md` e `STACK.md` para não contradizer o projeto real.

Use o template **`oxe/templates/SPEC.template.md`**: tabela **Critérios de aceite** com colunas **ID | Critério | Como verificar**.

**Brownfield (COBOL, JCL, copybooks, VB6, SP):** quando o objetivo for documentar ou planear migração, ver **`oxe/workflows/references/legacy-brownfield.md`** — epicos por **trilha** (batch, online, desktop↔SQL), critérios **A*** verificáveis por Grep/leitura/checklist, e secções opcionais alinháveis a `spec_required_sections` em `.oxe/config.json` (ver `oxe/templates/CONFIG.md`).

**Exploratório / sistema grande / reversa / modernização:** quando a tecnologia ou o âmbito for incerto, houver necessidade de **mapear** o sistema, **engenharia reversa** ou **hipóteses de modernização** antes de tarefas executáveis, recomendar **`oxe:research`** (notas datadas em `.oxe/research/` + índice `.oxe/RESEARCH.md`) **antes** de `oxe:plan` — sugestão, não bloqueio obrigatório para specs mínimas.
</context>

<process>
1. Resolver entrada: se começar com `@`, ler arquivo; senão usar o texto da conversa.
2. Criar ou atualizar **`.oxe/SPEC.md`** usando `oxe/templates/SPEC.template.md` como esqueleto. Se o ficheiro já existir com YAML inicial (`---` … `---` antes do primeiro `#`), **preservar** chaves existentes; **atualizar** `updated:` com a data ISO do dia; ajustar `status` (ex. para `ready`) se o utilizador declarar a spec fechada. Se não houver frontmatter, pode adicioná-lo na primeira edição substancial.
3. Garantir seções:
   - **Objetivo** — uma frase clara.
   - **Escopo** — bullets dentro / fora.
   - **Critérios de aceite** — tabela com IDs **A1**, **A2**, … (testáveis).
   - **Suposições e riscos**.
   - **Referências** — paths se conhecidos.
4. Atualizar **`.oxe/STATE.md`**: fase `spec_ready`, próximo passo `oxe:discuss` ou `oxe:plan` conforme `discuss_before_plan`.
5. Responder com resumo da spec e no máximo 3 perguntas objetivas se algo crítico estiver ambíguo.
</process>

<success_criteria>
- [ ] `.oxe/SPEC.md` existe e cada critério tem ID **A*** e forma de verificar.
- [ ] `STATE.md` atualizado.
- [ ] Ambiguidades críticas foram perguntas ou registradas como suposição explícita.
</success_criteria>
