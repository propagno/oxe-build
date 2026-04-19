# OXE — Workflow: research

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-spec`.
> Use: `/oxe-spec --research` ou `/oxe-spec --deep` para spike/pesquisa explícita.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Produzir **notas de pesquisa rastreáveis** em `research/YYYY-MM-DD-<slug>.md` do escopo resolvido e manter `RESEARCH.md` correspondente como **índice e histórico** (ligações, tipo, estado, resumo). Serve para qualquer incerteza antes de um plano pesado: spikes, comparação de tecnologias, due diligence, requisitos ambíguos, **e** — com profundidade quando pedido — compreensão de **sistemas grandes**, **engenharia reversa / brownfield** e **hipóteses de modernização** (sempre ligadas a evidência ou suposições explícitas).

Não substitui **SPEC** nem **PLAN**; alimenta decisões que depois entram na SPEC ou no PLAN.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-discovery.md`. A investigação deve separar fatos, inferências e lacunas antes de consolidar conclusões.
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, research vive em `.oxe/<active_session>/research/`; sem sessão ativa, usar `.oxe/research/`.
- Tratar pesquisa como **investigação estruturada**, não como nota solta. Cada investigação deve ter objetivo, fontes, modo, profundidade, conclusões e impacto na trilha.
- **Uma sessão = um ficheiro novo** em `research/`; não sobrescrever notas antigas salvo correção explícita do utilizador.
- Nome do ficheiro: **`YYYY-MM-DD-<slug-kebab>.md`** (data ISO do dia acordado na mensagem ou data atual; slug único, curto, ASCII preferível).
- **Índice:** `RESEARCH.md` do mesmo escopo deve conter tabela **Histórico** (mais recente primeiro) com colunas: **Data** | **Ficheiro** (`research/...`) | **Tema / âmbito** | **Tipo** (ex.: spike, mapa-sistema, reversa, modernização, decisão) | **Estado** (decidido / pendente / parcial) | **Resumo** (uma linha). Opcional: bloco **Última sessão** no topo com link para a nota mais recente.
- Preferir **`.oxe/SPEC.md`** existente; se o pedido for mapear/reverter **antes** de spec, criar a nota mesmo assim com **Contexto** a declarar ausência de SPEC e próximo passo `oxe:spec`.
- **Progressive disclosure:** sistemas grandes → profundidade por área; várias sessões/notas datadas em vez de um único ficheiro enorme.
- Template: **`oxe/templates/RESEARCH.template.md`**.
- Ler `INVESTIGATIONS.md` e investigações anteriores do escopo resolvido antes de abrir nova pesquisa sobre o mesmo assunto.
- Ler `.oxe/CAPABILITIES.md` quando a investigação depender de capability local, script ou conector já existente.
- Segurança: não gravar segredos nem valores de variáveis de ambiente.
</context>

<thinking_depth>
## Profundidade de Raciocínio

Antes de iniciar a pesquisa, classificar o tipo de investigação e calibrar a profundidade:

| Tipo | Indicadores | Abordagem |
|------|-------------|-----------|
| `surface` | Coletar fatos, comparar 2-3 opções conhecidas, confirmar API | Pesquisa padrão — fontes diretas, resposta objetiva |
| `standard` | Análise de trade-offs, integração de sistemas, avaliação de bibliotecas | Evidências múltiplas, prós/contras explícitos, referências cruzadas |
| `deep` | Reverse engineering de sistema existente, design de arquitetura nova, migração complexa, brownfield | **Extended thinking recomendado** se o modelo suportar — ativar raciocínio estendido antes de produzir a nota |

Anotar `thinking_depth: surface | standard | deep` no frontmatter da nota de pesquisa gerada.

**Quando `deep`:** instrua o modelo (explicitamente se necessário) a "raciocinar em profundidade antes de escrever a nota" — explorando hipóteses, descartando alternativas, mapeando incertezas antes de consolidar evidências.
</thinking_depth>

<process>
1. Garantir pastas `.oxe/` e `research/` do escopo resolvido.
2. Escolher `YYYY-MM-DD-<slug>.md` único; se colisão, acrescentar sufixo ao slug (ex. `-b`).
3. Criar a nota a partir de `RESEARCH.template.md`: preencher secções **base**; preencher secções de **reforço** ou marcar **N/A** com justificação curta quando o âmbito for sistema grande, reversa ou modernização.
4. Se `RESEARCH.md` do escopo resolvido não existir, criá-lo com título `# OXE — Índice de pesquisa`, parágrafo introdutório, secção **Histórico** com cabeçalho de tabela e primeira linha.
5. Se já existir, **atualizar** `RESEARCH.md` do escopo resolvido: nova linha no topo da tabela **Histórico** (mais recente primeiro); opcionalmente atualizar **Última sessão** com link para o ficheiro novo.
6. Atualizar `INVESTIGATIONS.md` do escopo resolvido com objetivo, fontes, modo, profundidade, conclusão e impacto na trilha. Se não existir, criá-lo.
7. Ler **`.oxe/SPEC.md`**, **`.oxe/codebase/*`** e código alvo (Glob/Grep/Read) conforme âmbito.
8. Atualizar **`.oxe/STATE.md`**: nota de fase / próximo passo típico `oxe:plan`, ou `oxe:spec` se faltar contrato, ou `oxe:ui-spec` se o foco for UI antes do plano.
9. Responder no chat em 5–10 linhas, nesta ordem:
   - **Fatos**
   - **Inferências**
   - **Lacunas**
   - **Próximo passo**
   Incluir o caminho da nota nova e a confirmação de atualização do índice.
</process>

<success_criteria>
- [ ] Existe novo ficheiro em `research/YYYY-MM-DD-<slug>.md` no escopo correto com secções base preenchidas de forma útil.
- [ ] `RESEARCH.md` do mesmo escopo existe e a tabela **Histórico** inclui a nova entrada.
- [ ] Nenhuma nota anterior foi sobrescrita sem instrução explícita do utilizador.
- [ ] `STATE.md` reflete o progresso e o próximo passo sugerido.
</success_criteria>
