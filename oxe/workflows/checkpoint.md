# OXE — Workflow: checkpoint

<objective>
Criar um **marco nomeado em disco** em **`.oxe/checkpoints/YYYY-MM-DD-HHmm-<slug>.md`** (data + hora + slug curto) e atualizar **`.oxe/CHECKPOINTS.md`** (índice): **snapshot da sessão / trilha corrente** para pausar e retomar sem apagar SPEC/PLAN.

**Não** duplica o papel de `git commit` nem de `verify`; é **registo explícito** para humanos e agentes. Para **atualizar o mapa do projeto inteiro** e alinhar `.oxe/codebase/` ao código, usar **`compact.md`** (`/oxe-compact`), não este passo.
</objective>

<context>
- **Checkpoint vs compact** e **momentos chave** da rotina: tabelas canónicas em **`help.md`** (secções *Checkpoint vs compact* e *Momentos chave*) — evitar divergência; este ficheiro descreve só a execução do checkpoint.

- Entrada: texto do utilizador = **slug** e/ou **nota** (ex.: `antes-refactor-auth` + “estado estável, falta T4”).
- Nome do ficheiro: **`YYYY-MM-DD-HHmm-<slug-kebab>.md`** (hora 24h local ou UTC — documentar na nota se misturar fusos).
- Frontmatter YAML no checkpoint (ver `oxe/templates/CHECKPOINT.template.md`): `created`, `slug`, `linked` (lista de paths relativos à raiz do repo, tipicamente `.oxe/STATE.md`, `.oxe/SPEC.md`, …).
- **Índice** `.oxe/CHECKPOINTS.md`: tabela **mais recente primeiro** com colunas **Data** | **Ficheiro** | **Slug** | **Nota (1 linha)**.
- Não mover nem apagar artefactos canónicos; o checkpoint é **documento adicional**.
</context>

<process>
1. Garantir pasta **`.oxe/checkpoints/`**.
2. Normalizar slug a partir dos argumentos do utilizador (kebab-case, ASCII; se vazio, usar `checkpoint`).
3. Escolher nome único; se colisão, acrescentar sufixo `-b`, `-c`, …
4. Escrever o ficheiro de checkpoint a partir do template: preencher frontmatter `linked` com os `.oxe/*.md` relevantes que **existem**; corpo com nota do utilizador e **snapshot** (trecho de STATE, uma linha de objetivo SPEC, resumo PLAN).
5. Se **`.oxe/CHECKPOINTS.md`** não existir, criar com título `# OXE — Índice de checkpoints` e tabela com cabeçalho; senão, **inserir linha no topo** da tabela.
6. Responder no chat: caminho do ficheiro novo + como usar na retomada (ler checkpoint + `linked` + próximo `oxe:*`).
</process>

<success_criteria>
- [ ] Novo ficheiro em `.oxe/checkpoints/` com frontmatter e corpo úteis.
- [ ] `CHECKPOINTS.md` atualizado com entrada correspondente.
- [ ] SPEC/PLAN/VERIFY intocados salvo o utilizador pedir outra coisa explicitamente.
</success_criteria>
