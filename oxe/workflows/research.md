# OXE — Workflow: research

<objective>
Produzir **notas de pesquisa rastreáveis** em **`.oxe/research/YYYY-MM-DD-<slug>.md`** e manter **`.oxe/RESEARCH.md`** como **índice e histórico** (ligações, tipo, estado, resumo). Serve para qualquer incerteza antes de um plano pesado: spikes, comparação de tecnologias, due diligence, requisitos ambíguos, **e** — com profundidade quando pedido — compreensão de **sistemas grandes**, **engenharia reversa / brownfield** e **hipóteses de modernização** (sempre ligadas a evidência ou suposições explícitas).

Não substitui **SPEC** nem **PLAN**; alimenta decisões que depois entram na SPEC ou no PLAN.
</objective>

<context>
- **Uma sessão = um ficheiro novo** em `.oxe/research/`; não sobrescrever notas antigas salvo correção explícita do utilizador.
- Nome do ficheiro: **`YYYY-MM-DD-<slug-kebab>.md`** (data ISO do dia acordado na mensagem ou data atual; slug único, curto, ASCII preferível).
- **Índice:** `.oxe/RESEARCH.md` deve conter tabela **Histórico** (mais recente primeiro) com colunas: **Data** | **Ficheiro** (`research/...`) | **Tema / âmbito** | **Tipo** (ex.: spike, mapa-sistema, reversa, modernização, decisão) | **Estado** (decidido / pendente / parcial) | **Resumo** (uma linha). Opcional: bloco **Última sessão** no topo com link para a nota mais recente.
- Preferir **`.oxe/SPEC.md`** existente; se o pedido for mapear/reverter **antes** de spec, criar a nota mesmo assim com **Contexto** a declarar ausência de SPEC e próximo passo `oxe:spec`.
- **Progressive disclosure:** sistemas grandes → profundidade por área; várias sessões/notas datadas em vez de um único ficheiro enorme.
- Template: **`oxe/templates/RESEARCH.template.md`**.
- Segurança: não gravar segredos nem valores de variáveis de ambiente.
</context>

<process>
1. Garantir pastas `.oxe/` e `.oxe/research/`.
2. Escolher `YYYY-MM-DD-<slug>.md` único; se colisão, acrescentar sufixo ao slug (ex. `-b`).
3. Criar a nota a partir de `RESEARCH.template.md`: preencher secções **base**; preencher secções de **reforço** ou marcar **N/A** com justificação curta quando o âmbito for sistema grande, reversa ou modernização.
4. Se **`.oxe/RESEARCH.md`** não existir, criá-lo com título `# OXE — Índice de pesquisa`, parágrafo introdutório, secção **Histórico** com cabeçalho de tabela e primeira linha.
5. Se já existir, **atualizar** `RESEARCH.md`: nova linha no topo da tabela **Histórico** (mais recente primeiro); opcionalmente atualizar **Última sessão** com link para o ficheiro novo.
6. Ler **`.oxe/SPEC.md`**, **`.oxe/codebase/*`** e código alvo (Glob/Grep/Read) conforme âmbito.
7. Atualizar **`.oxe/STATE.md`**: nota de fase / próximo passo típico `oxe:plan`, ou `oxe:spec` se faltar contrato, ou `oxe:ui-spec` se o foco for UI antes do plano.
8. Responder no chat em 5–10 linhas: caminho da nota nova, confirmação de atualização do índice, próximo passo OXE.
</process>

<success_criteria>
- [ ] Existe novo ficheiro em `.oxe/research/YYYY-MM-DD-<slug>.md` com secções base preenchidas de forma útil.
- [ ] `.oxe/RESEARCH.md` existe e a tabela **Histórico** inclui a nova entrada.
- [ ] Nenhuma nota anterior foi sobrescrita sem instrução explícita do utilizador.
- [ ] `STATE.md` reflete o progresso e o próximo passo sugerido.
</success_criteria>
