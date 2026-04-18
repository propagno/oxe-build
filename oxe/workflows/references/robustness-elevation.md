# OXE — Quality Contract Elevation (Spec Fase 3.5)

<objective>
Transformar a Fase 3.5 de uma lista de checklist em um **Contrato de Qualidade** formal: um conjunto de compromissos mensuráveis que o projeto assume antes de qualquer linha de código. Cada item recusado torna-se um risco documentado com severidade e responsável — não silenciosamente ignorado.

Cobre 6 dimensões: Segurança, Resiliência, Observabilidade, Confiança de Dados, Acessibilidade e Prontidão Operacional.
</objective>

---

## Conceito fundamental

Um checklist pergunta: *"você fez X?"*
Um contrato de qualidade pergunta: *"a que piso de qualidade este sistema se compromete antes de ser construído?"*

A diferença prática:
- Itens aprovados → viram **R-RB-NN** na spec → **Tn** no plan → verificados no verify
- Itens recusados → entram no **Accepted Risk Registry** com severidade, justificativa e responsável
- Nenhum risco some silenciosamente

---

## Parte I — Detector de Arquitetura (executa sempre, antes de qualquer checklist)

Oito cheiros detectáveis a partir da spec e stack descritos. Cada um detectado gera uma observação estruturada — não um bloqueio, mas um sinalizador que alimenta os checklists das Partes seguintes.

| Smell | Sinal de detecção na spec | Risco gerado |
|-------|--------------------------|--------------|
| **AS-1 God Module** | Um único módulo/serviço cobre domínios não relacionados (ex.: auth + billing + notificações) | Acoplamento oculto; mudança em um domínio quebra outro |
| **AS-2 Máquina de Estado Implícita** | Requisitos descrevem estados (rascunho, publicado, arquivado) sem tabela de transições explícita | Transições ilegais possíveis; comportamento indefinido em edge cases |
| **AS-3 Sem Escape Assíncrono** | Todas as operações descritas como síncronas; nenhuma menção a filas, eventos ou jobs para operações longas | Timeouts em cascata; usuário travado aguardando operações de longa duração |
| **AS-4 Serviço Escuro** | Nenhum requisito menciona logs, métricas ou rastreamento | Impossível diagnosticar falhas em produção; debugging cego |
| **AS-5 Coleta Ilimitada** | Dados são coletados mas sem política de retenção, arquivamento ou deleção | Crescimento de banco ilimitado; risco LGPD/GDPR por dados retidos além do necessário |
| **AS-6 Ponto Único de Falha Crítico** | Caminho crítico (auth, pagamento, core business) sem fallback, retry ou degradação definida | Falha de um componente derruba toda a operação |
| **AS-7 API Sem Versão** | API pública descrita sem estratégia de versionamento ou deprecação | Mudanças futuras quebram clientes sem aviso; impossível evoluir contrato |
| **AS-8 Deploy Acoplado** | Dois ou mais serviços/módulos distintos sempre fazem deploy juntos | Perda de autonomia; velocidade limitada pelo componente mais lento |

**Ação:** para cada smell detectado, mencionar ao usuário antes dos checklists: *"Identifiquei AS-N [nome]: [sinal encontrado]. Vamos abordar isso nos requisitos ou prefere registrar como risco?"*

---

## Parte II — Derivação de Ameaças (STRIDE)

Em vez de propor mitigações genéricas, derivar as **ameaças concretas** da arquitetura descrita e mapear mitigações ao vetor específico. O usuário vê *por que* cada controle existe, não apenas *o que* fazer.

**Domínios → Vetores STRIDE:**

| Domínio | Ameaça | Categoria STRIDE | Mitigações relacionadas |
|---------|--------|-----------------|------------------------|
| AUTH | Impostura de credenciais (brute force, credential stuffing) | **S**poofing | RB-SEC-A1, RB-SEC-A2, RB-SEC-A3 |
| AUTH | Sequestro de sessão (token roubado via XSS ou rede) | **S**poofing + **I**nformation Disclosure | RB-SEC-A4, RB-SEC-A7 |
| AUTH | Escalada de privilégio (acesso a recursos de outro usuário) | **E**levation of Privilege | RB-SEC-A4, RB-SEC-A7 |
| AUTH | Ausência de trilha de auditoria (negação de ações realizadas) | **R**epudiation | RB-OBS-L3 |
| API | Falsificação de requisição (CSRF, replay attacks) | **T**ampering | RB-SEC-H2, RB-SEC-A7 |
| API | Esgotamento de recursos (flood de requisições) | **D**enial of Service | RB-SEC-H3, RB-SEC-A2 |
| API | Vazamento de informação (stack traces, mensagens internas) | **I**nformation Disclosure | RB-SEC-H4, RB-OBS-L1 |
| DB | Injeção de dados (SQL/NoSQL injection) | **T**ampering | RB-SEC-D1 |
| DB | Exposição de dados sensíveis em repouso | **I**nformation Disclosure | RB-TRUST-T3 |
| DB | Ausência de auditoria de acesso a dados PII | **R**epudiation | RB-TRUST-T4 |
| FRONTEND | Injeção de script (XSS) | **T**ampering + **S**poofing | RB-SEC-F2 |
| FRONTEND | Token exposto em armazenamento acessível por script | **I**nformation Disclosure | RB-SEC-F1 |
| FILE | Execução de arquivo malicioso (malware upload) | **E**levation of Privilege | RB-SEC-FI1, RB-SEC-FI3 |
| FILE | Esgotamento de disco (upload bombs) | **D**enial of Service | RB-SEC-FI2 |

**Uso:** ao propor RB-SEC-NN ao usuário, referenciar a ameaça: *"RB-SEC-A2 (rate limiting) mitiga S1 — impostura de credencial por brute force identificada na sua arquitetura de login."*

---

## Parte III — 6 Dimensões de Qualidade

### Sistema de Tiers

| Tier | Nome | Significado | Risco se recusado |
|------|------|-------------|-------------------|
| 🔴 **Piso** | Floor | Ausente = falha ativa conhecida. Recusar = P0 no Accepted Risk Registry | P0 — bloqueia verify se `security_in_verify: true` |
| 🟡 **Base** | Foundation | Ausente = risco operacional significativo. Recusar = P1 documentado | P1 — consta no SECURITY.md / CONCERNS.md |
| 🟢 **Excelência** | Excellence | Diferencia sistemas bons de ótimos. Recusar = P2 ou mover para v2 sem fricção | P2 — registrado, não bloqueia |

---

### DIM-SEC — Segurança

| ID | Critério | Ameaça mitigada | Tier |
|----|----------|----------------|------|
| RB-SEC-A1 | Senhas hashed com bcrypt ou argon2 (salt rounds ≥ 10) | S1 Credential Spoofing | 🔴 Piso |
| RB-SEC-A2 | Rate limiting no login (≤ 10 tentativas / 15min / IP) | S1 Brute Force, D1 Flood | 🔴 Piso |
| RB-SEC-A3 | Comparação timing-safe em credenciais e tokens | S1 Timing Attack | 🔴 Piso |
| RB-SEC-A4 | Tokens de acesso em httpOnly cookie (nunca localStorage) | S2 Session Hijacking | 🔴 Piso |
| RB-SEC-A7 | CSRF protection (double-submit ou SameSite=Strict) | T1 Request Forgery | 🔴 Piso |
| RB-SEC-H1 | Security headers via Helmet ou equivalente | I1 Information Disclosure | 🔴 Piso |
| RB-SEC-H2 | CORS restrito a origens explícitas (sem `*` em produção) | T1 Request Forgery | 🔴 Piso |
| RB-SEC-H4 | Validação de schema em todas as entradas (Zod, Joi, etc.) | T1 Tampering, I1 Disclosure | 🔴 Piso |
| RB-SEC-D1 | Queries parametrizadas — sem interpolação de input | T2 Injection | 🔴 Piso |
| RB-SEC-F2 | Sanitização antes de `innerHTML` / `dangerouslySetInnerHTML` | T1 XSS | 🔴 Piso |
| RB-SEC-FI1 | Validação de MIME no servidor para uploads | EP1 Malware | 🔴 Piso |
| RB-SEC-H3 | Body size limit configurado | D1 Resource Exhaustion | 🟡 Base |
| RB-SEC-A5 | Refresh token com rotação + revogação persistida | S2 Session Hijacking | 🟡 Base |
| RB-SEC-FI3 | Nomes de arquivo sanitizados (sem path traversal) | EP1 Traversal | 🟡 Base |
| RB-SEC-D3 | Erros sem expor stack trace ou mensagens internas | I1 Information Disclosure | 🟡 Base |
| RB-SEC-FI2 | Limite de tamanho de arquivo configurável | D1 Disk Exhaustion | 🟡 Base |
| RB-SEC-A6 | Expiração de sessão configurável via env | EP1 Stale Session | 🟢 Excelência |
| RB-SEC-F3 | Links externos com `rel="noopener noreferrer"` | EP1 Tab Hijacking | 🟢 Excelência |

*Critérios Piso que não se aplicam em MVPs demo sem usuários reais: RB-SEC-A1, RB-SEC-A5 — marcar `fora` com justificativa explícita.*

---

### DIM-RES — Resiliência

Aplicar quando: qualquer dependência externa (API terceira, DB, serviço interno, fila).

| ID | Critério | Padrão de resiliência | Tier |
|----|----------|-----------------------|------|
| RB-RES-1 | Timeout explícito em todas as chamadas externas (DB, HTTP, filas) | Timeout | 🔴 Piso |
| RB-RES-2 | Comportamento definido quando dependência externa falha (fallback, erro amigável, degradação parcial) | Graceful Degradation | 🔴 Piso |
| RB-RES-3 | Retry com backoff exponencial + jitter em operações transitórias | Retry | 🟡 Base |
| RB-RES-4 | Circuit breaker em chamadas a serviços críticos (abre após N falhas consecutivas) | Circuit Breaker | 🟡 Base |
| RB-RES-5 | Operações longas (> 2s) executadas de forma assíncrona (fila, job, evento) | Async Escape Valve | 🟡 Base |
| RB-RES-6 | Idempotência garantida em operações críticas (pagamento, envio de email, criação de recurso) | Idempotency | 🟡 Base |
| RB-RES-7 | Bulkhead: pool de recursos isolado por tipo de operação (leitura vs escrita, rápido vs lento) | Bulkhead | 🟢 Excelência |
| RB-RES-8 | SLO definido: disponibilidade alvo (ex.: 99.9%) e latência p99 (ex.: < 500ms) | SLO | 🟢 Excelência |

---

### DIM-OBS — Observabilidade

Aplicar quando: qualquer serviço com endpoints HTTP, jobs, ou processamento de dados.

| ID | Critério | Pilar | Tier |
|----|----------|-------|------|
| RB-OBS-H1 | Endpoint `/health` ou `/api/health` retorna status 200 quando saudável | Health | 🔴 Piso |
| RB-OBS-L1 | Logs estruturados (JSON) com nível, timestamp, request_id e contexto de negócio | Logs | 🔴 Piso |
| RB-OBS-L2 | Erros críticos logados com stack trace + contexto suficiente para reproduzir | Logs | 🔴 Piso |
| RB-OBS-L3 | Ações sensíveis logadas com user_id e timestamp (login, logout, mudança de permissão, deleção) | Logs + Audit | 🟡 Base |
| RB-OBS-M1 | Métricas básicas expostas: latência de endpoint, taxa de erro, throughput | Metrics | 🟡 Base |
| RB-OBS-M2 | Alerta definido para degradação acima do threshold (ex.: error rate > 1% por 5min) | Alerting | 🟡 Base |
| RB-OBS-T1 | Request ID propagado em todos os serviços/chamadas de uma requisição | Traces | 🟢 Excelência |
| RB-OBS-T2 | Tracing distribuído (OpenTelemetry ou equivalente) para caminhos críticos | Traces | 🟢 Excelência |
| RB-OBS-D1 | Dashboard de golden signals: latência, tráfego, erros, saturação | Dashboard | 🟢 Excelência |

---

### DIM-TRUST — Confiança de Dados (LGPD / GDPR)

Aplicar quando: qualquer dado pessoal coletado (nome, email, CPF, IP, localização, comportamento).

| ID | Critério | Princípio legal | Tier |
|----|----------|----------------|------|
| RB-TRUST-T1 | Tabela de dados pessoais: campo, finalidade, base legal, quem acessa, tempo de retenção | Minimização + Finalidade | 🔴 Piso |
| RB-TRUST-T2 | Somente campos estritamente necessários à finalidade declarada são coletados | Minimização | 🔴 Piso |
| RB-TRUST-T3 | Dados sensíveis criptografados em repouso (campo ou disco) | Segurança | 🔴 Piso |
| RB-TRUST-T4 | Acesso a dados PII logado com user_id e timestamp (auditoria de acesso) | Responsabilização | 🟡 Base |
| RB-TRUST-T5 | Política de retenção automatizada: dados deletados ou anonimizados após N dias | Limitação de Retenção | 🟡 Base |
| RB-TRUST-T6 | Capacidade de exportar todos os dados de um usuário (portabilidade LGPD Art. 18) | Portabilidade | 🟡 Base |
| RB-TRUST-T7 | Capacidade de deletar completamente um usuário e seus dados (direito ao esquecimento) | Eliminação | 🟡 Base |
| RB-TRUST-T8 | Pseudonimização de PII em ambientes de desenvolvimento/staging | Segurança | 🟢 Excelência |
| RB-TRUST-T9 | Consentimento explícito registrado com timestamp e versão da política | Consentimento | 🟢 Excelência |

*Se o sistema processa dados pessoais, RB-TRUST-T1 e RB-TRUST-T2 são Piso independente de outros domínios.*

---

### DIM-ACCESS — Acessibilidade e UX de Erro

Aplicar quando: qualquer interface visível ao usuário final.

| ID | Critério | Padrão | Tier |
|----|----------|--------|------|
| RB-ACC-W1 | Contraste mínimo 4.5:1 para texto normal, 3:1 para texto grande (WCAG 2.1 AA) | WCAG 2.1 AA | 🔴 Piso |
| RB-ACC-W2 | Navegação completa por teclado (Tab, Enter, Esc em todos os fluxos críticos) | WCAG 2.1 AA | 🔴 Piso |
| RB-ACC-E1 | Mensagens de erro em linguagem natural — sem códigos internos, stack traces ou jargão técnico | Error UX | 🔴 Piso |
| RB-ACC-E2 | Estado de loading explícito em operações assíncronas (spinner, skeleton, texto) | Error UX | 🟡 Base |
| RB-ACC-E3 | Estado de erro com ação de recuperação sugerida (retry, contato, próximo passo) | Error UX | 🟡 Base |
| RB-ACC-W3 | Labels e ARIA em todos os campos e botões interativos | WCAG 2.1 AA | 🟡 Base |
| RB-ACC-W4 | Imagens não decorativas com texto alternativo descritivo | WCAG 2.1 AA | 🟡 Base |
| RB-ACC-E4 | Página de erro 404/500 com link de volta ao ponto seguro (home, dashboard) | Error UX | 🟡 Base |
| RB-ACC-W5 | Foco visível em elementos interativos (outline customizado ou padrão visível) | WCAG 2.1 AA | 🟡 Base |
| RB-ACC-W6 | Skip link para pular navegação repetitiva (acessibilidade para leitores de tela) | WCAG 2.1 AAA | 🟢 Excelência |

---

### DIM-OPS — Prontidão Operacional

Aplicar quando: qualquer serviço que vai a produção ou será operado por outra pessoa.

| ID | Critério | Categoria | Tier |
|----|----------|-----------|------|
| RB-OPS-S1 | Segredos exclusivamente via variáveis de ambiente — nunca hardcoded ou commitados | Secrets | 🔴 Piso |
| RB-OPS-S2 | `.env.example` documenta todas as variáveis obrigatórias com descrição | Secrets | 🔴 Piso |
| RB-OPS-D1 | Estratégia de deploy definida: como fazer deploy, rollback e smoke test | Deploy | 🟡 Base |
| RB-OPS-D2 | Migrations de banco reversíveis (down migration definida para cada up migration) | Deploy | 🟡 Base |
| RB-OPS-R1 | README com: pré-requisitos, como rodar localmente, como testar, variáveis necessárias | Docs | 🟡 Base |
| RB-OPS-R2 | Runbook mínimo: o que fazer quando o serviço cai (quem acionar, como diagnosticar) | Runbook | 🟡 Base |
| RB-OPS-D3 | Zero-downtime deploy ou janela de manutenção documentada para deploys com downtime | Deploy | 🟢 Excelência |
| RB-OPS-D4 | Feature flag ou kill switch para desativar funcionalidade nova sem redeploy | Deploy | 🟢 Excelência |
| RB-OPS-R3 | RTO / RPO definidos: quanto tempo de inatividade é aceitável, quanto dado pode ser perdido | Recovery | 🟢 Excelência |

---

## Parte IV — Accepted Risk Registry

Todo item recusado pelo usuário **deve** ser registrado no registro de riscos aceitos — nunca silenciado.

### Formato de entrada

```
| ID    | Critério recusado | Tier | Justificativa | Responsável | Data | Revisão |
|-------|-------------------|------|---------------|-------------|------|---------|
| AR-01 | RB-SEC-A2 (rate limiting) | Piso | MVP local sem exposição pública; revisitar em v2 | Eduardo | 2026-04-17 | Antes do deploy público |
```

### Onde registrar
- Na seção **"Suposições e riscos"** do `SPEC.md`, como tabela `## Riscos Aceitos`
- Itens com tier **Piso** recusados → também listados em `CONCERNS.md` com tag `[P0]`
- Revisados obrigatoriamente na **Fase 5 de aprovação** — usuário confirma ciência de cada P0/P1 aceito

### Regra de severidade no registry
| Tier do item recusado | Severidade no registry | Impacto no verify |
|----------------------|----------------------|-------------------|
| Piso | P0 — risco crítico documentado | Bloqueia `verify_complete` se `security_in_verify: true` |
| Base | P1 — risco operacional documentado | Aparece em SECURITY.md / CONCERNS.md |
| Excelência | P2 — débito técnico consciente | Registrado, não bloqueia |

---

## Parte V — Quality Score

Calculado ao final da Fase 3.5, antes de gerar o roteiro.

```
Quality Score = (Piso_aprovados / Piso_total × 60) + (Base_aprovados / Base_total × 40)
```

| Faixa | Significado | Ação |
|-------|-------------|------|
| 90–100 | Contrato de qualidade forte | Avançar; mencionar ao usuário |
| 70–89 | Contrato sólido com lacunas documentadas | Avançar; destacar P1s aceitos |
| 50–69 | Lacunas significativas — riscos operacionais relevantes | Avançar com alerta claro no SPEC |
| < 50 | Qualidade insuficiente para produção | Apresentar ao usuário antes de avançar; sugerir revisão |

**Regra de Piso:** se qualquer item Piso for recusado, o Quality Score é automaticamente exibido com `⚠ Piso incompleto` independente da pontuação total.

---

## Processo de elevação (Fase 3.5) — passo a passo

```
1. Executar Parte I (Detector de Arquitetura)
   → Listar smells detectados; apresentar ao usuário antes dos checklists

2. Executar Parte II (Derivação STRIDE)
   → Mapear domínios detectados → ameaças concretas

3. Para cada dimensão aplicável (SEC, RES, OBS, TRUST, ACCESS, OPS):
   a. Filtrar itens já cobertos pelos A* da Fase 3
   b. Propor itens restantes agrupados por Tier (Piso → Base → Excelência)
   c. Para cada item Piso: referenciar a ameaça STRIDE ou smell que o motivou

4. Apresentar ao usuário em bloco único:
   - Smells detectados (se houver)
   - Critérios por dimensão e tier (não todos de uma vez — agrupar por dimensão)
   - Para cada item Piso, mencionar: "Este item mitiga [ameaça/smell] e sua ausência é risco P0"

5. Aguardar decisão por dimensão (não item a item — reduz fricção)

6. Incorporar aprovados na tabela da Fase 3 como R-RB-NN

7. Registrar recusados no Accepted Risk Registry (Suposições e riscos do SPEC)

8. Calcular e exibir Quality Score

9. Se Quality Score < 50 ou Piso incompleto: apresentar resumo de riscos e confirmar com usuário antes de avançar
```

---

## Detecção de domínios aplicáveis

| Domínio | Ativa dimensões | Detectado quando |
|---------|----------------|-----------------|
| AUTH | SEC, OBS (audit), TRUST (se há dados pessoais) | Requisitos mencionam: login, logout, senha, sessão, JWT, token, autenticação |
| API | SEC, RES, OBS | Stack inclui: Express, Fastify, Hono, NestJS, Flask, Django, Spring — ou há rotas HTTP |
| DB | SEC, TRUST, OPS | Stack inclui: SQL, SQLite, PostgreSQL, MySQL, MongoDB, Prisma, Drizzle, Sequelize |
| FRONTEND | SEC, ACCESS, OBS | Stack inclui: React, Vue, Angular, Svelte, Next.js — ou há interface web |
| FILE | SEC, TRUST | Requisitos mencionam: upload, download, armazenamento de arquivos, S3, blob |
| DADOS PESSOAIS | TRUST (Piso automático) | Requisitos mencionam: email, CPF, nome, endereço, telefone, localização, IP de usuário |
| PRODUÇÃO | OPS | Requisitos ou contexto indicam deploy para ambiente acessível externamente |

---

## Regra de escopo mínimo

Critérios marcados como Piso são **fortemente recomendados** mas o usuário tem autoridade final.
Se recusar um Piso, registrar no Accepted Risk Registry com motivo — nunca forçar inclusão.
O Quality Score e o registro de riscos garantem transparência sem impor; a decisão permanece do usuário.
