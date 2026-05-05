# OXE — Workflow: spec

<objective>
Conduzir as **5 fases** do processo de especificação e produzir dois artefatos:

1. **`.oxe/SPEC.md`** — contrato formal com critérios de aceite estáveis (A1, A2, …) e coluna **Como verificar**.
2. **`.oxe/ROADMAP.md`** — fases de entrega mapeadas a requisitos (R-ID) e critérios (A*).

**Foco em redução de requisições:** as fases são estruturadas para extrair o máximo de informação por rodada — nunca uma pergunta por vez, sempre blocos coesos.

Para trabalho **muito pequeno** que não justifica spec completa: redirecionar para **`oxe:quick`**.

Se **`.oxe/config.json`** tiver `discuss_before_plan: true`: mencionar no final da Fase 5 que o próximo passo é **`oxe:discuss`** antes do plano.

**Flags suportadas:**
- `--refresh` — antes de iniciar, atualizar `.oxe/codebase/` em modo incremental (equivalente a `scan` modo refresh). Usar quando o codebase mudou desde o último scan.
- `--full` — antes de iniciar, forçar scan completo do codebase (equivalente a `scan --full`). Usar quando o mapa está obsoleto ou ausente.
- `--research` / `--deep` — ativar Fase 2 (Pesquisa) de forma explícita, mesmo que a incerteza detectada seja baixa. Útil para spikes, mapas de sistema, engenharia reversa.
- `--ui` — ao final da Fase 5, gerar contrato UI/UX em `.oxe/UI-SPEC.md` (equivalente a `/oxe-ui-spec`). Ativar automaticamente quando UI for domínio crítico detectado.

**Nota de compatibilidade v1.1.0:** `/oxe-scan`, `/oxe-research` e `/oxe-ui-spec` foram incorporados por este comando. Esses comandos legados continuam funcionando mas exibem aviso de migração.
</objective>

<context>
**Contrato de raciocínio:** aplicar `oxe/workflows/references/reasoning-discovery.md`. Antes de perguntar, explorar o que o repo e os artefatos já respondem; separar fatos, inferências e lacunas.

**Pré-requisito preferível:** scan executado. Se não existir, mencionar na spec que o mapa está pendente.

**Contrato de robustez:** seguir `oxe/workflows/references/flow-robustness-contract.md`. Antes de escrever, resolver artefatos obrigatórios, validar pré-condições e só então produzir a spec. O output desta fase deve deixar evidência estruturada suficiente para o `plan` decidir se o plano é realmente o melhor disponível.

**Discovery adaptativo:** antes da primeira pergunta, aplicar `oxe/workflows/references/adaptive-discovery.md`. Classificar a demanda, modular os blocos de perguntas conforme o domínio, limitar rodadas e consolidar incertezas estruturadas que depois alimentarão a confiança do plano.

**Rastreabilidade forte:** todo requisito `R-ID` precisa apontar para pelo menos um critério `A*` verificável, ou aparecer como v2/fora com justificativa. Critério sem método de verificação não entra como v1.

**Setup externo:** quando o sucesso depender de conta, variável de ambiente, dashboard, fila, banco, credencial, VPN ou recurso cloud, registrar em SPEC a seção **Setup externo e pré-condições**. O plano deve transformar isso em checkpoint ou tarefa explícita; não deixar como suposição solta.

**Contrato de indução da SPEC:** a SPEC deve sair forte o suficiente para que o usuário não precise compensar lacunas "no braço" durante o PLAN. Sempre extrair ou materializar explicitamente:
- público-alvo primário;
- outcome esperado observável;
- restrições técnicas obrigatórias e proibições relevantes;
- fluxos obrigatórios da v1;
- conteúdo mínimo exigido por área;
- exemplos mínimos esperados quando o pedido tocar UI, app, material didático, integração ou contrato público.

**Demandas de produto/app/UI:** quando o pedido for uma aplicação, página, dashboard, fluxo visual ou experiência educacional, a SPEC deve congelar antes do PLAN:
- blocos obrigatórios da interface;
- estados principais (`loading`, `empty`, `error`, `success` quando aplicável);
- interações mínimas esperadas;
- regras objetivas de responsividade e acessibilidade;
- critérios de aceite verificáveis por comportamento visível, não só por intenção narrativa.

**Entradas visuais / imagens anexadas:** quando o usuário enviar ou mencionar imagem, screenshot, mockup, wireframe ou anexo visual:
- deixar explícito que a inspeção visual depende do runtime hospedeiro (Copilot/Claude/Codex/etc.) e do modelo ativo;
- se o runtime permitir ver a imagem, antes de escrever requisitos gerar `.oxe/investigations/visual/VISUAL-INPUTS.md` e `.oxe/investigations/visual/VISUAL-INPUTS.json` usando `oxe/templates/VISUAL-INPUTS.template.*`;
- se o runtime não permitir ver a imagem, registrar `inspection_status: unavailable`, não inventar detalhes e pedir descrição textual quando a imagem for crítica;
- tratar anexo efêmero de chat como `reproducibility: chat_attachment_only`, salvo se houver arquivo local/materializado;
- requisitos derivados de imagem devem apontar para `VI-*` e para um anchor visual em `REFERENCE-ANCHORS` no plano;
- imagem crítica para UI, layout, fluxo ou regra funcional sem extração textual suficiente deve virar bloqueio explícito para `execute`.

**Resolução de sessão:** antes de ler ou escrever artefatos desta trilha, resolver `active_session` em `.oxe/STATE.md` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa:
- `SPEC.md`, `ROADMAP.md` e `DISCUSS.md` vivem em `.oxe/<active_session>/spec/`
- `OBSERVATIONS.md`, `RESEARCH.md` e `research/` seguem o escopo da sessão
- `LESSONS.md` continua global em `.oxe/global/LESSONS.md`
- sem sessão ativa, manter o modo legado na raiz `.oxe/`

Ler no início:
- `.oxe/STATE.md` — fase atual, decisões, workstream ativo
- `EXECUTION-RUNTIME.md`, `CHECKPOINTS.md` e `memory/` do escopo ativo se existirem — usar como contexto auxiliar, nunca como substituto da SPEC
- `.oxe/codebase/OVERVIEW.md` e `STACK.md` se existirem — não contradizer o repo
- **OBS do escopo ativo** — se houver entradas `pendente` com impacto `spec` ou `all`, incorporá-las na Fase 3 (Requisitos) e marcá-las `incorporada → spec (data)` após uso
- **`.oxe/global/LESSONS.md`** — se existir, ler entradas com `Aplicar em: spec` e status `ativo`. **Priorizar entradas com `Frequência >= 2` ou `Impacto: alto`** — aplicar como restrições explícitas. Entradas com `Frequência: 1` e `Impacto: baixo` são contexto secundário. Usar durante a Fase 1 (perguntas) e Fase 3 (requisitos). Exemplo: se uma lição diz "perguntar explicitamente sobre integração com X", adicionar essa pergunta no Bloco B da Fase 1.
- `.oxe/CAPABILITIES.md` e `.oxe/INVESTIGATIONS.md` — usar para sugerir capacidades e pesquisas já existentes antes de abrir novas lacunas
- `.oxe/investigations/visual/VISUAL-INPUTS.md|json` — se existirem ou se houver imagem/anexo no chat, usar como fonte visual estruturada; quando ausentes e imagem for crítica, gerar antes de fechar a SPEC
- Se o problema tocar Azure, ler `.oxe/cloud/azure/profile.json`, `auth-status.json` e `INVENTORY.md` antes de fechar requisitos; se o inventário estiver ausente ou stale, exigir discovery via `oxe-cc azure sync` antes de consolidar a spec

**Brownfield (COBOL, JCL, copybooks, VB6, SP):** quando o objetivo for documentar ou planear migração, ver **`oxe/workflows/references/legacy-brownfield.md`** — épicos por trilha, critérios A* verificáveis por Grep/leitura/checklist.

Usar templates: **`oxe/templates/SPEC.template.md`** e **`oxe/templates/ROADMAP.template.md`**.
Para entradas visuais, usar também **`oxe/templates/VISUAL-INPUTS.template.md`** e **`oxe/templates/VISUAL-INPUTS.template.json`**.
</context>

<fase_1_perguntas>
## Fase 1 — Perguntas

**Objetivo:** entender completamente a ideia antes de qualquer escrita de artefato.

**Classificar a demanda no início:** antes do primeiro bloco, rotular a trilha com um tipo dominante (`feature`, `bugfix`, `refactor`, `investigação`, `migração`, `integração`, `infra`, `dados`, `ui`, `segurança`). Registar esse tipo na seção de contexto da SPEC.

**Regra de ouro:** nunca uma pergunta por vez — sempre um **bloco coeso** de 3-5 perguntas por rodada. Máximo **3 rodadas**; sinalize quando achar que tem entendimento completo e peça confirmação antes de avançar.

**Blocos de perguntas (adaptar ao contexto):**

*Bloco A — Objetivo e motivação:*
- Qual o problema central que isso resolve? Quem se beneficia?
- Há uma solução atual (mesmo que ruim)? O que falha nela?
- Como o sucesso será medido — qual o indicador mais importante?

*Bloco B — Restrições e tecnologia:*
- Quais tecnologias ou frameworks são obrigatórios ou proibidos?
- Há restrições de prazo, orçamento, tamanho do time ou infraestrutura?
- Quais integrações existentes precisam ser mantidas?

*Bloco C — Casos extremos e escopo:*
- Quais cenários de erro ou casos extremos são críticos de tratar na v1?
- O que definitivamente está **fora** do escopo desta entrega?
- Há comportamento esperado que você sabe que não é óbvio?

**Estratégia de rodadas:**
- Rodada 1: blocos A + B (entendimento geral)
- Rodada 2: bloco C + clarificações específicas (se necessário)
- Rodada 3 (máx): apenas se ainda houver ambiguidade crítica
- Após rodada 3: avançar para Fase 2 mesmo com suposições explícitas

**Ao final:** "Acho que entendi completamente. Confirma antes de avançarmos para pesquisa/requisitos? [resumo em 3-5 bullets]"

**Registar incertezas estruturadas:** ao fim de cada rodada, consolidar:
- o que já está estável;
- o que segue ambíguo;
- quais evidências faltam;
- quais riscos podem reduzir a confiança do plano.
- quais anchors, fixtures ou investigações serão obrigatórios para permitir `Confiança > 90%` no plano.
- se houver imagem/anexo visual: quais elementos foram inspecionados, quais ficaram ambíguos e se `VISUAL-INPUTS` está `ready`, `partial` ou `blocked`.
</fase_1_perguntas>

<fase_2_pesquisa>
## Fase 2 — Pesquisa (opcional, recomendada)

**Objetivo:** investigar domínios incertos antes de escrever requisitos.

**Proposta ao usuário:** com base na Fase 1, listar 2-4 áreas de investigação sugeridas e perguntar quais investigar. Exemplos:
- "Há 3 áreas com incerteza técnica: autenticação JWT, integração com Stripe, e deploy em edge. Quer investigar alguma antes de avançar para requisitos?"
- "A trilha depende de Azure e o inventário está incompleto. Quer sincronizar recursos reais antes de congelar os requisitos?"

**Se aprovado:**
- Criar notas de pesquisa datadas em `research/YYYY-MM-DD-<slug>.md` no escopo ativo (usar fluxo de `research.md`)
- Atualizar `RESEARCH.md` no mesmo escopo
- Atualizar `INVESTIGATIONS.md` com objetivo, fontes, profundidade, resultado e impacto na trilha
- Consolidar descobertas relevantes antes de avançar para Fase 3

**Se pulado:** registrar em `SPEC.md` as áreas de incerteza como suposições explícitas.

**Explorações grandes / sistemas legado:** ver **`oxe/workflows/references/legacy-brownfield.md`** — progressive disclosure por área, multiple sessions, epicos por trilha.
</fase_2_pesquisa>

<domain_question_library>
## Biblioteca de perguntas por domínio

Complemento adaptativo para a Fase 1. Quando o domínio for confirmado (via scan ou resposta da Fase 1), adicionar o bloco correspondente às perguntas de rodada 2 ou 3. **Nunca adicionar todos os blocos** — usar apenas os relevantes.

---

### Domínio: API REST / GraphQL

*Adicionar ao Bloco B quando o escopo toca endpoints ou contratos de API:*

- O contrato da API é público (consumido por outros times/clientes externos) ou interno?
- Quais endpoints existentes serão modificados vs criados do zero?
- Há versionamento de API (v1/v2)? O que acontece com clientes na versão antiga?
- Qual a estratégia de autenticação: JWT Bearer, API Key, OAuth, sessão?
- Há rate limiting, throttling ou quotas a considerar?
- Como erros de validação devem ser retornados (formato JSON, campos obrigatórios)?
- Há documentação de API (OpenAPI/Swagger) que deve ser atualizada junto?

*Critérios A* a sugerir (adaptar ao contexto):*
- `A-N: POST /recurso retorna 201 com payload correto quando input válido`
- `A-N: POST /recurso retorna 400 com campo errors[] quando input inválido`
- `A-N: GET /recurso retorna 401 sem Bearer token válido`
- `A-N: Stack trace ausente em todas as respostas de erro`

---

### Domínio: Autenticação e Autorização

*Adicionar ao Bloco B quando o escopo toca auth, sessões, permissões ou RBAC:*

- Qual o mecanismo de autenticação existente? Está sendo mantido ou substituído?
- Há multi-tenancy? Usuários de tenant A podem ver dados de tenant B?
- Qual o modelo de autorização: RBAC, ABAC, ACL, baseado em ownership?
- O que acontece com tokens existentes se o sistema de auth mudar?
- Como o logout funciona: client-side only, blacklist server-side, ou short TTL?
- Há requisitos de MFA, SSO ou integração com IdP externo (Keycloak, Auth0, SAML)?
- Qual o TTL dos tokens de acesso e de refresh?

*Critérios A* a sugerir:*
- `A-N: Rota protegida retorna 403 para usuário autenticado sem permissão`
- `A-N: Token expirado recebe 401, não 500`
- `A-N: Usuário de tenant A não retorna dados de tenant B em nenhum endpoint`
- `A-N: Senha armazenada como hash bcrypt/argon2 — nenhum plaintext no banco`

---

### Domínio: Banco de dados e Migrations

*Adicionar ao Bloco B quando o escopo toca schema ou dados persistidos:*

- Há dados existentes que serão afetados? Quantas linhas aproximadamente?
- A migration é aditiva (add column, new table) ou destrutiva (drop, rename, type change)?
- Qual é a janela de manutenção? A migration pode rodar online (zero-downtime)?
- Se a migration falhar no meio, qual o estado do banco? É reversível via `down()`?
- Há dependências: outras tabelas, serviços, ou queries que leem os campos afetados?
- Os índices existentes serão afetados? Há criação de índice em tabela grande (lock)?
- Há necessidade de backfill de dados? Com qual estratégia (batch, job assíncrono)?

*Critérios A* a sugerir:*
- `A-N: Migration é reversível via down() sem perda de dados`
- `A-N: Zero registros com campo NOT NULL ausente após migration`
- `A-N: Nenhum índice existente é dropado inadvertidamente`
- `A-N: Backfill completa sem timeout e sem bloquear leituras`

---

### Domínio: UI e Frontend

*Adicionar ao Bloco B quando o escopo toca interface de usuário:*

- Qual o dispositivo alvo primário — desktop, mobile, ambos?
- Há design system ou biblioteca de componentes obrigatória (ex.: Material, Tailwind)?
- O estado deve ser persistido entre reloads de página?
- Há requisitos de acessibilidade (WCAG)? Qual nível (A, AA, AAA)?
- Como carregamento de dados é gerenciado: loading state, error state, empty state?
- Há internacionalização (i18n) ou múltiplos idiomas a suportar?
- Qual a estratégia de tratamento de erros visível ao usuário?

*Critérios A* a sugerir:*
- `A-N: Componente exibe loading state enquanto dados carregam`
- `A-N: Erro de API exibe mensagem legível, não stack trace`
- `A-N: Formulário desabilita submit enquanto request está em andamento`
- `A-N: Todos os campos de formulário têm label associada (WCAG básico)`

*Para páginas estáticas, apps sem framework ou experiências didáticas, também perguntar:*
- Quais blocos da página são obrigatórios acima da dobra e abaixo da dobra?
- O conteúdo é mais exploratório, guiado passo a passo, ou ambos?
- Quais interações precisam existir obrigatoriamente na v1?
- O progresso do usuário precisa persistir entre reloads?
- Há exemplos de conteúdo, visualização ou exercícios mínimos que a aplicação precisa materializar?

---

### Domínio: Filas, Eventos e Processamento Assíncrono

*Adicionar ao Bloco B quando o escopo toca mensageria ou jobs:*

- O que acontece se a mensagem não puder ser processada? Há dead-letter queue?
- Qual a garantia de entrega: at-most-once, at-least-once, ou exactly-once?
- O consumer é idempotente? O que acontece se a mesma mensagem chegar duas vezes?
- Há ordering guarantee? As mensagens precisam ser processadas em ordem?
- Qual o SLA de processamento? Há timeout esperado?
- Como monitorar backlog? Há alertas quando a fila cresce além de N mensagens?
- Qual a estratégia de retry? Com backoff exponencial? Limite de tentativas?

*Critérios A* a sugerir:*
- `A-N: Consumer idempotente — processar a mesma mensagem 2x não duplica efeito`
- `A-N: Mensagem inválida vai para DLQ com metadados de diagnóstico`
- `A-N: Consumer continua operando após falha transiente (retry com backoff)`
- `A-N: Backlog não cresce indefinidamente — processamento acompanha produção`

---

### Domínio: Dados, ETL e Pipelines

*Adicionar ao Bloco B quando o escopo toca ingestão, transformação ou exportação:*

- Qual o volume de dados (linhas/dia, GB/hora)?
- Qual a janela de processamento: batch diário, near-realtime, ou streaming?
- O que acontece se o dado de entrada estiver malformado ou faltando campos?
- Há dependência de fuso horário? Como timestamps são normalizados?
- O pipeline é idempotente — reprocessar o mesmo input não duplica saída?
- Como o progresso é rastreado? Há checkpointing para retomada após falha?
- Quais são as métricas de qualidade de dados obrigatórias (completude, unicidade)?

*Critérios A* a sugerir:*
- `A-N: Registro inválido é rejeitado e vai para dead-letter com motivo explicito`
- `A-N: Reprocessar o mesmo input não duplica registros de saída`
- `A-N: Pipeline completa dentro da janela de SLA definida`

---

### Domínio: Infraestrutura e Deploy

*Adicionar ao Bloco B quando o escopo toca infraestrutura ou processo de deploy:*

- Em qual ambiente a mudança será implantada primeiro (dev/staging/prod)?
- Há downtime aceitável? Ou é obrigatório zero-downtime (rolling deploy)?
- Qual o processo de rollback se algo der errado em produção?
- Há variáveis de ambiente a adicionar? Quem configura em produção e quando?
- A mudança requer scaling ou mudança de capacidade (CPU, memória, instâncias)?
- Health checks ou readiness probes precisam ser atualizados?
- Como validar em produção: feature flag, canary release, A/B, smoke test?

*Critérios A* a sugerir:*
- `A-N: Deploy não causa downtime perceptível (< 30s de interrupção)`
- `A-N: Rollback é possível em < 15 minutos sem perda de dados`
- `A-N: Health check retorna 200 após deploy bem-sucedido`
- `A-N: Todas as variáveis de ambiente estão documentadas em SPEC antes do deploy`
</domain_question_library>

<fase_3_requisitos>
## Fase 3 — Requisitos

**Objetivo:** extrair uma tabela clara de requisitos com versionamento (v1/v2/fora).

**Incorporar primeiro:** verificar `.oxe/OBSERVATIONS.md` por entradas `pendente` com impacto `spec` ou `all` — incorporar aqui antes de finalizar a tabela.

**Formato da tabela:**

| R-ID | Requisito | Versão | Critério de aceite |
|------|-----------|--------|--------------------|
| R1 | [o que o sistema deve fazer] | v1 | A1 — [como verificar] |
| R2 | [outro requisito] | v1 | A2 — [como verificar] |
| R3 | [requisito futuro] | v2 | A3 — [quando implementado] |
| R4 | [fora do escopo] | fora | — |

**Definições:**
- **v1** = MVP essencial; entra no próximo `/oxe-plan`
- **v2** = evolução futura; entra em ciclos seguintes
- **fora** = explicitamente descartado desta entrega

**Apresentar ao usuário para validação** antes de avançar para Fase 4. Se ajustar: atualizar tabela e repetir até aprovação.
</fase_3_requisitos>

<fase_35_elevacao_robustez>
## Fase 3.5 — Elevação de Robustez (automática)

**Objetivo:** propor proativamente critérios de hardening baseados no stack detectado, antes de criar o roteiro. Garante que segurança e robustez entrem na spec — e portanto no plan, nos testes e no verify — em vez de ficarem como auditoria pós-hoc.

**Referência canônica:** `oxe/workflows/references/robustness-elevation.md`

**Execução:**

1. **Detectar domínios** presentes: AUTH, API, DB, FRONTEND, FILE — via scan artifacts ou inferência da Fase 1.
2. **Para cada domínio detectado**, percorrer o catálogo abaixo e filtrar critérios já cobertos por A* existentes.
3. **Propor** os critérios restantes como R-RB-NN com prioridade sugerida.
4. **Apresentar ao usuário** em bloco único — domínios detectados, critérios propostos com justificativa breve para os v1 críticos.
5. **Aguardar decisão** — usuário confirma, ajusta versão ou descarta.
6. **Incorporar aprovados** na tabela da Fase 3; registrar descartados com justificativa em "Suposições e riscos".

**Regra:** nunca forçar inclusão. Se o usuário descartar um v1 crítico, registrar o motivo explicitamente para auditoria futura.

**Pulável apenas se:** stack não se encaixa em nenhum domínio (ex.: script CLI puro sem auth, sem HTTP, sem DB). Nesse caso, registrar explicitamente: "Fase 3.5 não aplicável: [motivo]".

---

### Catálogo de critérios por domínio

#### AUTH — critérios de segurança de autenticação

| R-RB | Critério | Prioridade | Justificativa |
|------|----------|------------|---------------|
| R-RB-A01 | Senha nunca retornada em resposta de API (nem em log) | v1 crítico | Vazamento via resposta ou observabilidade |
| R-RB-A02 | Rate limit em tentativas de login falhas (ex.: 5/min por IP) | v1 crítico | Proteção contra brute force |
| R-RB-A03 | JWT valida `iss`, `aud`, `exp` e `iat` em toda rota protegida | v1 crítico | Tokens de outros sistemas aceitos |
| R-RB-A04 | Refresh token rotacionado a cada uso | v1 | Prevenção de token replay |
| R-RB-A05 | Logout invalida token server-side (blacklist ou short TTL) | v1 | Logout não impede uso do token |
| R-RB-A06 | Headers de segurança presentes: CSP, X-Frame-Options, HSTS | v2 | Proteção contra XSS/clickjacking |
| R-RB-A07 | Cookies com `Secure` + `HttpOnly` + `SameSite=Strict` | v1 se usa cookies | CSRF + XSS via cookie |
| R-RB-A08 | Credenciais de admin não hardcoded em código ou config | v1 crítico | Secret exposto no repositório |

#### API REST — critérios de segurança de endpoint

| R-RB | Critério | Prioridade | Justificativa |
|------|----------|------------|---------------|
| R-RB-R01 | Toda rota tem validação de schema de entrada (DTO/Zod/Joi) | v1 crítico | Input não validado = injection risk |
| R-RB-R02 | Erros de validação retornam 400 com campo `errors[]` estruturado | v1 | Feedback objetivo ao cliente |
| R-RB-R03 | Stack trace ausente em todas as respostas de erro (4xx e 5xx) | v1 crítico | Exposição de internals ao cliente |
| R-RB-R04 | Paginação obrigatória em listas (sem retornar N ilimitado) | v1 | DoS por dump de tabela grande |
| R-RB-R05 | Rate limiting em endpoints públicos e autenticados | v1 | Abuso de API |
| R-RB-R06 | CORS configurado explicitamente — nunca `Access-Control-Allow-Origin: *` em produção | v1 se frontend externo | Acesso cross-origin não intencional |
| R-RB-R07 | IDs de recursos opacos (UUID/ULID/nanoid, não int sequencial) | v2 | Enumeração de recursos |
| R-RB-R08 | Timeout em todas as chamadas a dependências externas | v1 | Hang em falha de dependency |

#### DB — critérios de segurança de banco de dados

| R-RB | Critério | Prioridade | Justificativa |
|------|----------|------------|---------------|
| R-RB-D01 | Queries usam prepared statements ou ORM — zero concatenação de string | v1 crítico | SQL injection |
| R-RB-D02 | Connection pool com tamanho máximo configurado | v1 | Esgotamento de conexões em load |
| R-RB-D03 | Transações em operações multi-step (atomicidade garantida) | v1 | Dados inconsistentes em falha parcial |
| R-RB-D04 | Migrations idempotentes e com `down()` reversível | v1 | Rollback impossível |
| R-RB-D05 | Campos sensíveis (PII, segredos) criptografados ou hasheados | v1 se há PII | Exposure em dump de banco |
| R-RB-D06 | Índices para queries de alta frequência | v2 | Degradação de performance sob load |
| R-RB-D07 | Soft delete preferido sobre hard delete em entidades de negócio | v2 | Perda acidental irrecuperável de dados |

#### FRONTEND — critérios de segurança de UI

| R-RB | Critério | Prioridade | Justificativa |
|------|----------|------------|---------------|
| R-RB-F01 | Dados do usuário escapados antes de renderizar no DOM | v1 crítico | XSS via conteúdo dinâmico |
| R-RB-F02 | Formulários têm proteção CSRF (token ou SameSite) | v1 se usa cookies/sessão | CSRF attack |
| R-RB-F03 | API keys / segredos ausentes no bundle client-side | v1 crítico | Exposição de credenciais via DevTools |
| R-RB-F04 | Loading, error e empty states implementados em todos os fluxos | v1 | UX quebrada em falha de rede |
| R-RB-F05 | Inputs sanitizados antes de envio (sem XSS via form) | v1 | Injection via campo de formulário |
| R-RB-F06 | Deep links funcionam no reload da página (rota não quebra) | v1 | UX ruim e links não compartilháveis |
| R-RB-F07 | Labels acessíveis em todos os inputs (WCAG 2.1 AA mínimo) | v2 | Acessibilidade básica |

#### FILE / Storage — critérios de segurança de upload

| R-RB | Critério | Prioridade | Justificativa |
|------|----------|------------|---------------|
| R-RB-S01 | Tipo de arquivo validado por magic bytes, não apenas extensão | v1 crítico | Upload de executável com extensão .jpg |
| R-RB-S02 | Tamanho de arquivo com limite máximo configurado | v1 crítico | DoS por upload de arquivo gigante |
| R-RB-S03 | Arquivos armazenados fora do webroot (não servíveis diretamente) | v1 crítico | Path traversal + execução remota |
| R-RB-S04 | Nome do arquivo sanitizado — nunca usar nome original do cliente | v1 | Path traversal no sistema de arquivos |
| R-RB-S05 | URLs de download com TTL (presigned URLs, não permanentes) | v1 se dados sensíveis | Vazamento por link compartilhado |
| R-RB-S06 | Scan de malware em uploads (se domínio crítico de segurança) | v2 | Upload e redistribuição de malware |
</fase_35_elevacao_robustez>

<fase_4_roteiro>
## Fase 4 — Roteiro

**Objetivo:** criar fases de entrega mapeadas aos requisitos v1 e escrever `ROADMAP.md` no escopo ativo da sessão.

**Lógica de agrupamento:**
- Agrupar requisitos v1 em fases por **dependência técnica** e **valor entregável**
- Cada fase deve ter resultado demonstrável (não apenas código interno)
- Fase 1 = o que `/oxe-plan` implementará no próximo ciclo
- Fases 2+ = ciclos futuros de spec→plan→execute→verify

**Escrever `ROADMAP.md`** usando `oxe/templates/ROADMAP.template.md` no escopo ativo:

```markdown
---
oxe_doc: roadmap
status: draft
updated: <data>
spec_ref: SPEC.md
---

## Fase 1 — [Nome]
**Requisitos:** R1, R3
**Critérios de aceite:** A1, A2, A3
**Escopo:** ...

## Fase 2 — [Nome]
**Requisitos:** R2, R5
**Critérios de aceite:** A4, A5
**Escopo:** ...

## Fora do escopo (v2+)
- R4: [descrição] — motivo
```
</fase_4_roteiro>

<auto_reflexao>
## Auto-reflexão semântica (executa automaticamente antes da Fase 5)

**Objetivo:** o agente critica a própria spec antes de apresentá-la ao usuário. Sem requisição extra — é um passe interno de qualidade semântica.

Percorrer esta lista de verificação:

| # | Verificação | Ação se falhar |
|---|-------------|----------------|
| 1 | **Contradições:** algum requisito v1 contradiz diretamente uma resposta da Fase 1? (ex.: usuário disse "sem auth" mas R4 implica sessões) | Voltar à Fase 3 e corrigir o requisito |
| 2 | **Verificabilidade:** todo critério A* tem "Como verificar" executável sem acesso ao ambiente de produção do usuário? | Refinar para verificação possível no CI/agente ou marcar "verificação manual necessária" |
| 3 | **Escopo creep:** algum requisito v1 foi adicionado que NÃO emergiu da Fase 1 nem da Fase 2? | Mover para v2 ou justificar inclusão em v1 |
| 4 | **Conflito com stack:** algum requisito v1 pressupõe tecnologia ou capacidade que `STACK.md` indica ausente? (ex.: requer WebSocket mas stack usa REST puro) | Marcar como suposição explícita ou remover |
| 5 | **Critérios vagos:** algum A* usa linguagem não-mensurável ("deve ser rápido", "interface amigável") sem métrica? | Refinar: "resposta < 200ms p95", "WCAG 2.1 AA" |
| 6 | **Dependências implícitas:** algum requisito v1 pressupõe que outro requisito (v2 ou fora) já esteja implementado? | Tornar dependência explícita ou reordenar versioning |
| 7 | **Elevação de robustez:** todos os domínios detectados (AUTH, API, DB, FRONTEND, FILE) tiveram R-RB-NN propostos ou explicitamente descartados com justificativa? | Se Fase 3.5 foi pulada sem justificativa, executar agora ou registrar como risco em "Suposições e riscos" |

**Resultado obrigatório antes de avançar:**
- **0 problemas** → avançar para Fase 5 normalmente.
- **1–2 problemas** → corrigir inline na spec, anotar o que foi ajustado em 1 linha.
- **3+ problemas** → apresentar lista ao usuário com a Fase 3 revisada (não reiniciar do zero).

O resultado desta reflexão é **invisível ao usuário** — é trabalho interno do agente. Somente os ajustes feitos aparecem na spec final.

**Saída estruturada obrigatória para o plan:** após esta reflexão, a SPEC final deve deixar explícitos:
- requisitos estáveis;
- ambiguidades restantes;
- conflitos resolvidos ou ainda abertos;
- evidências faltantes que podem reduzir a confiança do plano.
</auto_reflexao>

<spec_anti_patterns>
## Anti-padrões de especificação

Detectar e corrigir estes problemas antes de entregar a SPEC. A auto-reflexão da Fase 3.5 deve capturar a maioria, mas são registrados aqui como referência explícita para revisão manual.

---

### Critério A* não verificável

**Problema:** `A3 — Sistema deve ser escalável e performático`
**Por quê é ruim:** "escalável" e "performático" sem métrica são impossíveis de testar. O executor não sabe quando passou.
**Solução:** `A3 — Sistema responde < 200ms em p95 com 100 usuários simultâneos (teste k6 smoke em staging)` — métrica, percentil, carga, ambiente.

---

### Escopo creep implícito

**Problema:** usuário pediu "adicionar campo de telefone no perfil". A SPEC incluiu "refatorar módulo de perfil completo" em v1.
**Por quê é ruim:** o usuário não pediu refatoração — foi decisão unilateral do agente. Scope não autorizado.
**Solução:** incluir apenas o que emergiu da Fase 1/2. Refatorações sugeridas vão para v2 ou são registradas em CONCERNS com nota "sugerido, não solicitado".

---

### Suposição técnica não registrada

**Problema:** a SPEC integra com Stripe e assume que `STRIPE_SECRET_KEY` já está configurada em produção.
**Por quê é ruim:** o plan vai criar a integração, mas o executor vai falhar por falta de credencial sem diagnóstico claro.
**Solução:** toda suposição de ambiente vai explicitamente em "Setup externo e pré-condições" da SPEC. O plan converte suposições críticas em tarefas de verificação (Onda 1, action_type: `collect_evidence`).

---

### Requisito v1 que depende de v2

**Problema:** `R1 (v1) — Notificações em tempo real` depende de `R5 (v2) — WebSocket server`.
**Por quê é ruim:** o plano de v1 não pode executar R1 sem R5 existir. O plano vai falhar na verificação.
**Solução:** ou mover R1 para v2, ou mover R5 para v1, ou re-especificar R1 sem WebSocket (ex.: polling com SSE).

---

### Critérios que conflitam entre si

**Problema:** `A1 — Processar arquivo CSV em < 5s` e `A7 — Arquivo CSV pode ter até 1 GB`.
**Por quê é ruim:** 1 GB em 5s pode ser fisicamente impossível dependendo da infra. Os dois critérios são contraditórios sem especificação de condições.
**Solução:** tornar as condições consistentes: "< 5s para arquivos até 10 MB; processamento assíncrono para arquivos > 10 MB com status via polling".

---

### Fase 3.5 pulada sem justificativa

**Problema:** SPEC finalizada sem executar elevação de robustez, sem nota explicando por quê.
**Por quê é ruim:** vulnerabilidades conhecidas (XSS, SQL injection, brute force) não entram na v1 e viram dívida técnica imediata.
**Solução:** sempre executar Fase 3.5. Se o stack não se encaixa em nenhum domínio, registrar: "Fase 3.5 não aplicável: CLI puro sem HTTP, sem DB, sem auth".

---

### ROADMAP sem resultado demonstrável por fase

**Problema:** `Fase 1 — Implementar a lógica interna de processamento` sem resultado visível.
**Por quê é ruim:** fases sem resultado demonstrável são estágios de código interno que o usuário não consegue validar.
**Solução:** toda fase do ROADMAP deve ter resultado demonstrável: "Fase 1 — Usuário consegue fazer login, receber JWT válido e acessar rota protegida".

---

### Setup externo invisível na SPEC

**Problema:** SPEC menciona "integrar com serviço de email" sem listar as credenciais necessárias nem quem as configura.
**Por quê é ruim:** o plan vai criar a integração, mas vai falhar em staging/produção por falta de configuração externa.
**Solução:** adicionar seção obrigatória `## Setup externo e pré-condições` com: variáveis de ambiente necessárias, contas/recursos a criar, e quem é responsável por cada item.

---

### Requisito verificável apenas em produção

**Problema:** `A5 — Sistema envia email de boas-vindas para usuário real após cadastro`.
**Por quê é ruim:** não é possível verificar em CI/CD sem sandbox do provedor de email. O agente não tem acesso ao email real.
**Solução:** tornar verificável em ambiente controlado: `A5 — Integração com SendGrid sandbox envia email para endereço de teste; log confirma `202 Accepted` do provider`. Ou marcar explicitamente "verificação manual necessária" com critério de como realizar.
</spec_anti_patterns>

<fase_5_aprovacao>
## Fase 5 — Aprovação e próximo passo

**Objetivo:** confirmar o roteiro com o usuário e redirecionar para o plano.

**Apresentar resumo:**
- Objetivo em 1 frase
- Requisitos v1 (N itens), v2 (M itens), fora (K itens)
- Roteiro: Fase 1 → N critérios; Fase 2 → M critérios
- Critérios de aceite da Fase 1: A1, A2, …

**Perguntar ao usuário:**
> "Roteiro aprovado? Quer gerar o plano agora ou ajustar algo antes?"

**Se aprovado — oferecer os próximos passos:**

| Opção | Quando usar | Próximo passo |
|-------|-------------|---------------|
| Plano simples | Tarefa clara, sem orquestração multi-agente | `/oxe-plan` |
| Plano com agentes | Time distribuído, domínios distintos, ondas paralelas | `/oxe-plan-agent` |
| Discutir antes | `discuss_before_plan: true` em config, ou risco técnico | `/oxe-discuss` → `/oxe-plan` |

**Se ajustar:** voltar à fase indicada (Requisitos, Roteiro ou Perguntas) e repetir.

**Ao finalizar:**
- Marcar `ROADMAP.md` → `status: approved`
- Atualizar `STATE.md`: `phase: spec_ready`, próximo passo conforme escolha
- Se flag `--ui` foi recebida **ou** se UI foi detectada como domínio crítico: executar a lógica de `oxe/workflows/ui-spec.md` e produzir `.oxe/UI-SPEC.md` como extensão desta spec. Mencionar ao usuário que o contrato UI foi gerado.
</fase_5_aprovacao>

<process>
0. **Processar flags recebidas:**
   - `--refresh`: executar a lógica de `oxe/workflows/compact.md` (modo incremental) antes de continuar. Reportar breve resumo das mudanças detectadas.
   - `--full`: executar a lógica de `oxe/workflows/scan.md` (modo bootstrap completo) antes de continuar. Reportar arquivos-chave mapeados.
   - `--research` / `--deep`: registrar internamente que a Fase 2 (Pesquisa) deve ser executada de forma explícita, mesmo se incerteza parecer baixa.
   - `--ui`: registrar internamente que ao final da Fase 5, o contrato UI-SPEC deve ser gerado automaticamente.
   - Sem flags: verificar se `.oxe/codebase/` existe e está relativamente recente; se não existir, mencionar que scan seria recomendado antes da spec.
1. Ler `.oxe/STATE.md`, `OVERVIEW.md`, `STACK.md` e `OBSERVATIONS.md` do escopo ativo (verificar pendentes).
2. Fazer uma exploração inicial do repo e dos artefatos antes da primeira rodada de perguntas. Consolidar internamente: fatos confirmados, inferências e lacunas.
3. Aplicar `adaptive-discovery.md`: classificar a demanda, verificar se há capabilities úteis e se investigações anteriores reduzem incerteza.
4. **Fase 1 — Perguntas:** enviar bloco coeso de 3-5 perguntas; máx 3 rodadas; confirmar entendimento.
5. **Fase 2 — Pesquisa:** propor áreas de investigação; aguardar aprovação; executar se aprovado.
6. **Fase 3 — Requisitos:** extrair tabela R-ID com v1/v2/fora e critérios A*; incorporar OBS pendentes; apresentar para validação.
6.5. **Fase 3.5 — Elevação de Robustez:** detectar domínios (AUTH/API/DB/FRONTEND/FILE); propor R-RB-NN não cobertos; aguardar decisão; incorporar aprovados na tabela antes de avançar.
7. **Fase 4 — Roteiro:** agrupar requisitos v1 em fases (incluindo R-RB aprovados); escrever `ROADMAP.md` no escopo ativo.
8. Escrever **`SPEC.md`** usando `oxe/templates/SPEC.template.md` no escopo ativo:
   - Frontmatter YAML (`oxe_doc: spec`, `status`, `updated`, `inputs`)
   - Objetivo, Escopo (dentro/fora), Critérios de aceite (tabela A*), Suposições e riscos, Referências
   - Preencher explicitamente `Tipo de demanda` e `Incertezas estruturadas`
   - Preservar chaves existentes se SPEC.md já existir; atualizar `updated:`
8b. **Auto-reflexão:** executar integralmente o bloco `<auto_reflexao>` antes de avançar. Corrigir a spec conforme necessário. Não apresentar a lista de verificação ao usuário — apenas a spec corrigida.
9. **Fase 5 — Aprovação:** apresentar resumo, aguardar aprovação do roteiro, redirecionar.
10. Atualizar **`.oxe/STATE.md`** global: `phase: spec_ready`, próximo passo e referência curta à sessão ativa quando existir.
11. Marcar OBS incorporadas em `OBSERVATIONS.md` do escopo ativo se houver pendentes de impacto `spec`.
</process>

<success_criteria>
- [ ] `SPEC.md` existe no escopo correto (`spec/` da sessão ou `.oxe/` legado) com critérios A* e coluna Como verificar; `STATE.md` global atualizado.
- [ ] `ROADMAP.md` existe no mesmo escopo com fases mapeadas a R-IDs e A*, status `approved` (ou `draft` se usuário não confirmou).
- [ ] Tabela de requisitos R-ID foi apresentada e validada (v1/v2/fora) antes do roteiro.
- [ ] Usuário foi consultado no gate da Fase 5 e escolheu o próximo passo.
- [ ] OBS pendentes com impacto `spec` foram incorporadas e marcadas `incorporada`.
- [ ] Máximo 3 rodadas de perguntas utilizadas — não mais.
- [ ] Fase 3.5 executada: domínios detectados tiveram R-RB-NN propostos, aprovados ou descartados com justificativa.
</success_criteria>
