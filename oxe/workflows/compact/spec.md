<!-- variante compacta de oxe/workflows/spec.md (OXB-132): gerada por scripts/build-compact-workflows.cjs. Em dúvida, leia a completa. -->
# OXE — Workflow: spec
<objective>
1. **`.oxe/SPEC.md`** — contrato formal com critérios de aceite estáveis (A1, A2, …) e coluna **Como verificar**.
2. **`.oxe/ROADMAP.md`** — fases de entrega mapeadas a requisitos (R-ID) e critérios (A*).
3. **`.oxe/PRD.md`** — a camada de produto acima da SPEC (`oxe/templates/PRD.template.md`): problema, personas, objetivos com métricas (M-n) e **histórias de usuário** (US-n: Como / Quero / Para), cada uma ligada aos R* e A* que a entregam. As histórias são o que vai para o ALM (Jira / Azure DevOps) quando o projeto usa um.
**Foco em redução de requisições:** as fases são estruturadas para extrair o máximo de informação por rodada — nunca uma pergunta por vez, sempre blocos coesos.
</objective>
<context>
**Contrato de robustez:** seguir `oxe/workflows/references/flow-robustness-contract.md`. Antes de escrever, resolver artefatos obrigatórios, validar pré-condições e só então produzir a spec. O output desta fase deve deixar evidência estruturada suficiente para o `plan` decidir se o plano é realmente o melhor disponível.
**Contrato de indução da SPEC:** a SPEC deve sair forte o suficiente para que o usuário não precise compensar lacunas "no braço" durante o PLAN. Sempre extrair ou materializar explicitamente:
- restrições técnicas obrigatórias e proibições relevantes;
- fluxos obrigatórios da v1;
- blocos obrigatórios da interface;
- `EXECUTION-RUNTIME.md`, `CHECKPOINTS.md` e `memory/` do escopo ativo se existirem — usar como contexto auxiliar, nunca como substituto da SPEC
- Se o problema tocar Azure, ler `.oxe/cloud/azure/profile.json`, `auth-status.json` e `INVENTORY.md` antes de fechar requisitos; se o inventário estiver ausente ou stale, exigir discovery via `oxe-cc azure sync` antes de consolidar a spec
</context>
## Fase 1 — Perguntas (grill)
1. `oxe-cc grill start --type <tipo>`. **Ao refinar um card isolado de ALM/Jira**, passe **sempre `--card <KEY>`** em todos os comandos do grill (`oxe-cc grill start --card OXE-n`, `ask --card OXE-n`, `answer --card OXE-n`, `close --card OXE-n`, `report --card OXE-n`) — isso isola o estado em `.oxe/alm/grill/<KEY>/` (incluindo ADRs em `.oxe/alm/grill/<KEY>/adr/` e relatório em `.oxe/alm/grill/grooming-quality.md`) sem sobrescrever `.oxe/grill/` ou `.oxe/SPEC.md` do programa inteiro. Se já houver grill aberto, ele é retomado: `oxe-cc grill status [--card <KEY>]` mostra onde parou.
2. Explore o repo e os artefatos primeiro. O que já tem resposta vira `oxe-cc grill fact --branch <ramo> --text "…" --source <arquivo:linha|card>`, nunca pergunta.
3. **Uma pergunta por mensagem**, seguindo o `next_branch` da árvore (problema → personas → escopo → fluxos → regras/glossário → bordas → NFR → integrações → rollout → métricas → riscos). Cada pergunta traz o que decide, as opções com consequência e a **resposta recomendada com o porquê**. Registre com `grill ask` antes de perguntar e com `grill answer` depois.
4. Contradição → `grill conflict <Q-a,Q-b>`; "não sei" → `grill defer <Q-n> --reason "…"` (vira suposição); termos de negócio → `grill term "<termo>" --definition "…"`; decisão de arquitetura, produto ou trade-off → `--decision` (vira ADR).
5. Ao fechar cada ramo, faça o playback em 3 a 5 linhas e, com o "sim", rode `oxe-cc grill confirm <ramo>`.
6. Não há limite de rodadas: o grill termina quando `oxe-cc grill close` aceita. Se ele recusar, mostre o que falta e continue.
- quais anchors, fixtures ou investigações serão obrigatórios para permitir `Confiança > 90%` no plano.
## Fase 2 — Pesquisa (opcional, recomendada)
<domain_question_library>
## Biblioteca de perguntas por domínio
Complemento adaptativo para a Fase 1. Quando o domínio for confirmado (via scan ou resposta da Fase 1), adicionar o bloco correspondente às perguntas de rodada 2 ou 3. **Nunca adicionar todos os blocos** — usar apenas os relevantes.
### Domínio: API REST / GraphQL
- Como erros de validação devem ser retornados (formato JSON, campos obrigatórios)?
### Domínio: Autenticação e Autorização
### Domínio: Banco de dados e Migrations
### Domínio: UI e Frontend
- Há design system ou biblioteca de componentes obrigatória (ex.: Material, Tailwind)?
- Quais blocos da página são obrigatórios acima da dobra e abaixo da dobra?
### Domínio: Filas, Eventos e Processamento Assíncrono
### Domínio: Dados, ETL e Pipelines
- Quais são as métricas de qualidade de dados obrigatórias (completude, unicidade)?
### Domínio: Infraestrutura e Deploy
- Há downtime aceitável? Ou é obrigatório zero-downtime (rolling deploy)?
</domain_question_library>
## Fase 3 — Requisitos
## Fase 3.5 — Elevação de Robustez (automática)
1. **Detectar domínios** presentes: AUTH, API, DB, FRONTEND, FILE — via scan artifacts ou inferência da Fase 1.
2. **Para cada domínio detectado**, percorrer o catálogo abaixo e filtrar critérios já cobertos por A* existentes.
3. **Propor** os critérios restantes como R-RB-NN com prioridade sugerida.
4. **Apresentar ao usuário** em bloco único — domínios detectados, critérios propostos com justificativa breve para os v1 críticos.
5. **Aguardar decisão** — usuário confirma, ajusta versão ou descarta.
6. **Incorporar aprovados** na tabela da Fase 3; registrar descartados com justificativa em "Suposições e riscos".
**Regra:** nunca forçar inclusão. Se o usuário descartar um v1 crítico, registrar o motivo explicitamente para auditoria futura.
### Catálogo de critérios por domínio
#### AUTH — critérios de segurança de autenticação
| R-RB-A01 | Senha nunca retornada em resposta de API (nem em log) | v1 crítico | Vazamento via resposta ou observabilidade |
#### API REST — critérios de segurança de endpoint
| R-RB-R04 | Paginação obrigatória em listas (sem retornar N ilimitado) | v1 | DoS por dump de tabela grande |
| R-RB-R06 | CORS configurado explicitamente — nunca `Access-Control-Allow-Origin: *` em produção | v1 se frontend externo | Acesso cross-origin não intencional |
#### DB — critérios de segurança de banco de dados
#### FRONTEND — critérios de segurança de UI
#### FILE / Storage — critérios de segurança de upload
| R-RB-S04 | Nome do arquivo sanitizado — nunca usar nome original do cliente | v1 | Path traversal no sistema de arquivos |
## Fase 4 — Roteiro
**Programa por fases (aplicações com 2+ fases):** depois da aprovação, rodar `oxe-cc runtime program init` (lê o `ROADMAP.md` e grava `.oxe/program/PROGRAM.json`) e `oxe-cc runtime program start`. A partir daí cada fase é um ciclo completo que fecha pelo gate `oxe-cc runtime program close` (exige `--by <papel> --reason "…"` quando usado com `--by-ci`, `--no-rollback-check` ou `--accept-drift`): verify concluído, **regressão das fases anteriores verde**, contratos do IMPLEMENTATION-PACK cumpridos e commit local da fase. As interfaces entregues por uma fase entram no contexto da seguinte. ROADMAP de fase única dispensa o programa.
<auto_reflexao>
## Auto-reflexão semântica (executa automaticamente antes da Fase 5)
**Resultado obrigatório antes de avançar:**
**Saída estruturada obrigatória para o plan:** após esta reflexão, a SPEC final deve deixar explícitos:
</auto_reflexao>
<spec_anti_patterns>
## Anti-padrões de especificação
### Critério A* não verificável
### Escopo creep implícito
### Suposição técnica não registrada
### Requisito v1 que depende de v2
### Critérios que conflitam entre si
### Fase 3.5 pulada sem justificativa
**Solução:** sempre executar Fase 3.5. Se o stack não se encaixa em nenhum domínio, registrar: "Fase 3.5 não aplicável: CLI puro sem HTTP, sem DB, sem auth".
### ROADMAP sem resultado demonstrável por fase
### Setup externo invisível na SPEC
**Solução:** adicionar seção obrigatória `## Setup externo e pré-condições` com: variáveis de ambiente necessárias, contas/recursos a criar, e quem é responsável por cada item.
### Requisito verificável apenas em produção
</spec_anti_patterns>
## Fase 5 — Aprovação e próximo passo
**Se aprovado:** termine com **um** próximo passo, o do rodapé (`references/next-step-footer.md`). Em geral: `spec check` verde → `oxe-cc spec approve --by <papel>`; aprovada com ROADMAP de 2+ fases → `oxe-cc runtime program init`; senão → `/oxe-plan` (agentes e discuss são decididos dentro dele, com `--agents` ou `discuss_before_plan`).
1. `oxe-cc spec check`: rastreabilidade R→A, Risco e Como verificar em todo A*, PRD (`prd lint`), glossário (sinônimos proibidos), grill fechado, decisões registradas, RFC para P0/P1. Corrija tudo o que ele apontar.
2. `oxe-cc spec probe`: bordas e proibições por critério. Resolva cada borda: coberta, descartada com motivo ou suposição.
3. Opcional: `oxe-cc spec stress`, com leitores independentes que propõem mudanças. Roda processos pagos, então peça o OK do usuário antes.
4. Com o resumo aprovado: `oxe-cc spec approve --by <papel>`. Daí em diante, mudança de critério passa por `oxe-cc spec amend` (ver `references/change-management.md`).
- Rodar **`oxe-cc prd lint`**: história sem critério, critério sem história, referência a A*/R* inexistente. Corrigir antes de seguir.
- **ALM:** se `.oxe/config.json` tem `alm.provider` (`jira` ou `azure-devops`), rodar `oxe-cc alm push --stories-only --dry-run`, mostrar ao usuário o que será criado (épico, histórias com a versão-alvo) e, com o OK, `oxe-cc alm push --stories-only --apply`. Sem ALM configurado, seguir sem ele — nada no fluxo depende disso.
<process>
0. **Processar flags recebidas:**
1. Ler `.oxe/STATE.md`, `OVERVIEW.md`, `STACK.md` e `OBSERVATIONS.md` do escopo ativo (verificar pendentes).
2. Fazer uma exploração inicial do repo e dos artefatos antes da primeira rodada de perguntas. Consolidar internamente: fatos confirmados, inferências e lacunas.
3. Aplicar `adaptive-discovery.md`: classificar a demanda, verificar se há capabilities úteis e se investigações anteriores reduzem incerteza.
4. **Fase 1 — Grill:** `oxe-cc grill start` ou retomar; uma pergunta por mensagem, com a recomendada; playback e `grill confirm` por ramo; `grill close` (gera o glossário e as decisões). Com `--fast`: blocos de 3 a 5 perguntas, máximo 3 rodadas.
5. **Fase 2 — Pesquisa:** propor áreas de investigação; aguardar aprovação; executar se aprovado.
6. **Fase 3 — Requisitos:** extrair tabela R-ID com v1/v2/fora e critérios A*; incorporar OBS pendentes; apresentar para validação.
7. **Fase 4 — Roteiro:** agrupar requisitos v1 em fases (incluindo R-RB aprovados); escrever `ROADMAP.md` no escopo ativo.
8. Escrever **`SPEC.md`** usando `oxe/templates/SPEC.template.md` no escopo ativo:
   - Objetivo, Escopo (dentro/fora), Critérios de aceite (tabela A*, com a coluna `Risco` P0–P3: o close da fase decide PASS, CONCERNS ou FAIL por ela, e um P2/P3 com lacuna só fecha com `oxe-cc runtime waive`), Suposições e riscos, Referências
8a. Escrever **`PRD.md`** usando `oxe/templates/PRD.template.md` no mesmo escopo: problema, personas, métricas (M-n), histórias US-n ligadas aos R*/A*, fora de escopo, riscos de negócio. Mudança de escopo depois da aprovação: nova `version:` e uma linha no histórico, nunca reescrever o passado.
8b. **Auto-reflexão:** executar integralmente o bloco `<auto_reflexao>` antes de avançar. Corrigir a spec conforme necessário. Não apresentar a lista de verificação ao usuário — apenas a spec corrigida.
9. **Fase 5 — Aprovação:** apresentar resumo, aguardar aprovação do roteiro, redirecionar.
10. Atualizar **`.oxe/STATE.md`** global: `phase: spec_ready`, próximo passo e referência curta à sessão ativa quando existir.
11. Marcar OBS incorporadas em `OBSERVATIONS.md` do escopo ativo se houver pendentes de impacto `spec`.
</process>
**Ao terminar:** o **Próximo passo** de `oxe-cc status --json` (ver `references/next-step-footer.md`).
<success_criteria>
- [ ] `PRD.md` existe com histórias US-n ligadas aos A*, e `oxe-cc prd lint` passa; com ALM configurado, as histórias foram enviadas (`oxe-cc alm push --stories-only --apply`).
- [ ] Usuário aprovou o roteiro no gate da Fase 5, e a resposta terminou com um único próximo passo (rodapé).
- [ ] Grill fechado (`oxe-cc grill close`), com cada critério, história e termo rastreável a uma pergunta; ou `--fast` com no máximo 3 rodadas.
- [ ] `oxe-cc spec check` verde e spec aprovada (`oxe-cc spec approve`); RFC em rascunho para cada P0/P1.
</success_criteria>
