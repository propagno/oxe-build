# OXE — Workflow: scan

<objective>
Analisar o codebase e produzir documentação **estruturada, densa e navegável** em `.oxe/codebase/`, atualizando `.oxe/STATE.md`.

**Meta:** os sete documentos produzidos devem ser tão informativos que um agente novo — humano ou `LlmTaskExecutor` — consiga formular tarefas precisas e executar mudanças corretas sem abrir código-fonte adicional nos casos comuns.

**Foco opcional:** se o usuário indicar uma área (ex.: `api`, `auth`), priorizar essa pasta ou módulo nos mapeamentos. Produzir os sete documentos mesmo com foco, mas com detalhe reduzido nas demais áreas — mencionando que existem.

Se **`.oxe/config.json`** tiver `scan_focus_globs` ou `scan_ignore_globs`, **priorizar** os caminhos do foco e **reduzir detalhe** nas áreas ignoradas — ainda assim mencioná-las com path e propósito resumido.
</objective>

<context>
- Diretório de saída: **`.oxe/`** na raiz do projeto. Criar se não existir.
- Carregar `oxe/templates/STATE.md` como base se `STATE.md` ainda não existir; se existir, preservar histórico e atualizar **Último scan** (campo **Data:** em formato ISO **YYYY-MM-DD**) e **Fase**.
- Se existir **`.oxe/config.json`**, respeitar `scan_focus_globs`, `scan_ignore_globs`, `scan_max_age_days`, `scale_adaptive`, `profile`. **Não** sobrescrever o arquivo no scan.
- Não apagar `SPEC.md` / `PLAN.md` se já existirem — apenas atualizar o codebase.
- Entre scans completos, **`compact.md`** (`/oxe-compact`) pode **atualizar incrementalmente** os mesmos sete ficheiros comparando-os ao repo atual e registar mudanças em **`CODEBASE-DELTA.md`**.
- **Prioridade de leitura de contexto:** carregar `.oxe/context/packs/scan.md` e `.oxe/context/packs/scan.json` **antes** de qualquer Glob/Grep abrangente. Se o pack existir e estiver fresco, usá-lo como mapa primário e reduzir leituras adicionais. Se stale, ausente ou incompleto, fazer fallback explícito para leitura direta e registrar o motivo.
</context>

<mode_detection>
## Detecção automática de modo: bootstrap vs refresh

Antes de iniciar, verificar se `.oxe/codebase/` já existe com os sete mapas:

- **Modo bootstrap** (padrão quando codebase/ não existe ou está incompleto): produzir os sete arquivos do zero.
- **Modo refresh** (quando codebase/ existe e tem os sete mapas): executar lógica de `oxe/workflows/compact.md` — comparar mapas ao repo atual, atualizar incrementalmente, produzir `CODEBASE-DELTA.md` e `RESUME.md`. **Não refazer do zero.**

**Flags:**
- `--full`: forçar modo bootstrap mesmo se codebase/ existir.
- `--refresh`: forçar modo refresh.
- **Sem flag:** automático. Se mapas existem e o último scan foi há menos de `scan_max_age_days` (default: 7 dias), sugerir refresh e perguntar antes de executar scan completo.

**Staleness check:** se `STATE.md` tiver `scan_date` e a diferença para hoje superar `scan_max_age_days`, alertar que os mapas podem estar desatualizados antes de usá-los como base para plan/spec.
</mode_detection>

<architectural_detection>
## Detecção de padrão arquitetural

Antes de produzir os documentos, classificar o padrão arquitetural dominante. Isso calibra o nível de detalhe e as seções prioritárias em cada documento.

### Padrões e sinais

| Padrão | Sinais principais |
|--------|------------------|
| **Monolito MVC** | Único `main.*` na raiz de `src/`; pastas `controllers/`, `services/`, `repositories/`, `models/`; único manifest de build |
| **Microserviços** | Múltiplos `package.json`/`pom.xml` em subpastas de serviço; `docker-compose.yml` com múltiplos serviços; pastas `services/<nome>/` com entrypoint próprio |
| **Monorepo** | `packages/<nome>/` com build independente; `turbo.json`, `nx.json`, `lerna.json`, `pnpm-workspace.yaml` |
| **DDD / Camadas** | Pastas `domain/`, `application/`, `infrastructure/`, `presentation/`; entities, value objects, aggregates separados de implementações |
| **CQRS** | Pastas `commands/` e `queries/` separadas; padrão `*Command.ts`/`*Query.ts` + `*Handler.ts`; bus de comandos/eventos |
| **Hexagonal / Clean** | Pastas `adapters/`, `ports/`, `core/`; inversão de dependência; interfaces no core, implementações em adapters |
| **Event-driven** | SDKs de broker (`kafka`, `rabbitmq`, `@azure/service-bus`, `sqs`, `celery`); arquivos `*.consumer.ts`, `*.producer.ts`, `*.handler.ts` |
| **CLI** | `commander`, `yargs`, `argparse`, `click`, `cobra`; entrypoint é um executável; sem servidor HTTP |
| **Serverless** | `serverless.yml`, SAM templates, `*.lambda.ts`; handlers independentes sem servidor longo |

### Detecção de domínios funcionais

Identificar domínios funcionais para calibrar INTEGRATIONS, CONCERNS e CONVENTIONS:

| Domínio | Sinais de detecção |
|---------|--------------------|
| **AUTH** | `jwt`, `passport`, `oauth`, `session`, `bcrypt`, `keycloak`, `auth0`, `cognito`, `rbac`, `acl` |
| **API REST** | `express`, `fastapi`, `spring-web`, `routes/`, `controllers/`, `@Controller`, `@RestController` |
| **GraphQL** | `graphql`, `apollo`, `resolvers/`, `*.graphql`, `*.gql`, `@Resolver` |
| **DB relacional** | `typeorm`, `prisma`, `sequelize`, `migrations/`, `*.sql`, `knex`, `drizzle`, `hibernate` |
| **DB NoSQL** | `mongoose`, `mongodb`, `dynamodb`, `firestore`, `redis`, `elasticsearch` |
| **Filas/eventos** | `kafka`, `rabbitmq`, `sqs`, `@azure/service-bus`, `bull`, `celery`, `nats`, `pulsar` |
| **Storage** | `s3`, `blob`, `multer`, `sharp`, `uploads/`, `minio`, `gcs` |
| **Email/notificação** | `nodemailer`, `sendgrid`, `mailgun`, `ses`, `twilio`, `fcm`, `apns` |
| **Frontend/UI** | `react`, `vue`, `angular`, `svelte`, `next`, `nuxt`, `components/`, `pages/` |
| **Infra/IaC** | `*.tf`, `*.bicep`, `*.arm.json`, `helm/`, `k8s/`, `cdk/`, `pulumi/` |

### Registrar em OVERVIEW.md

Ao final da detecção, adicionar seção em OVERVIEW.md:
```
## Padrão arquitetural
- **Dominante:** [padrão detectado]
- **Evidências:** `[arquivo1]`, `[arquivo2]`, `[pasta3]`
- **Domínios funcionais:** AUTH, API REST, DB relacional [lista dos detectados]
- **Desvios / notas:** [ex.: "camada de domínio incompleta — services acessam DB diretamente em billing/"]
```
</architectural_detection>

<document_quality_guide>
## Guia de qualidade por documento

Cada documento deve atingir o nível descrito abaixo. Use como checklist interno **antes de finalizar** cada arquivo.

---

### OVERVIEW.md — o mapa de orientação

**Objetivo:** permitir que qualquer agente entenda o sistema em 60 segundos sem abrir código.

**Deve conter:**
- Propósito em 1-2 frases (o que, para quem, por quê)
- Padrão arquitetural com evidências (ver `<architectural_detection>`)
- Domínios funcionais com 1 linha cada
- Fluxo principal end-to-end em 5-15 bullets (descrever o que acontece, não listar arquivos)
- Módulos de alto nível com papel resumido
- Link para documentação humana se existir (`docs/`, `README.md`)

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Sistema de gestão de usuários" | "API REST multi-tenant que gerencia autenticação JWT + RBAC para N organizações; exposta via Express em `api/`; dados persistidos em PostgreSQL via TypeORM" |
| "Tem frontend e backend" | "Monorepo: `api/` (Express), `web/` (Next.js), `shared/` (tipos + validações); comunicação via REST; state via React Query no client" |
| Copiar o README | Síntese do README + observações do código que o README não cobre |

**Anti-padrões:** frases genéricas sem evidência; listar arquivos individuais; omitir o padrão arquitetural.

---

### STACK.md — o inventário tecnológico

**Deve conter:**
- Runtime e versão exata (ex.: `Node.js 20.11 LTS`)
- Framework principal e versão (ex.: `Express 4.18.3`)
- Banco de dados com driver/ORM e versão (ex.: `PostgreSQL 15.6 via TypeORM 0.3.20`)
- Build toolchain com versão (ex.: `Vite 5.2`, `Maven 3.9.6`)
- **Dependências críticas** com versão e papel — as que, se mudarem, quebram o sistema
- Variáveis de ambiente chave que afetam comportamento (nomes, sem valores)
- DevDependencies relevantes (linters, test runner)

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Usa Node e TypeScript" | "`Node.js 20.11 LTS`, `TypeScript 5.4` (strict), `Express 4.18.3`, `TypeORM 0.3.20`" |
| "Tem dependências externas" | "Deps críticas: `zod@3.22` (validação em runtime em todas as rotas), `ioredis@5.3` (cache + rate-limit), `jsonwebtoken@9.0` (tokens JWT); mudar versão desses 3 afeta testes de integração" |

**Anti-padrões:** listar 200 deps sem filtrar; omitir versões; ignorar env vars que afetam stack.

---

### STRUCTURE.md — o mapa de navegação

**Deve conter:**
- Árvore lógica de no máximo 3 níveis (não listar cada arquivo — agregar por propósito)
- Entrypoints: onde o programa começa e como inicializar
- Organização de `src/` por domínio com papel de cada pasta
- Onde ficam: testes, configs, scripts de build, migrations, assets
- Convenções de nomeação de arquivos (ex.: `*.controller.ts`, `*.service.ts`)
- **"Onde adicionar novo código"** para pelo menos 3 tipos de mudança comuns

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Tem pasta src/" | "`src/` por domínio: `auth/` (JWT + guards), `users/` (CRUD + perfil), `billing/` (Stripe + invoices). Cada domínio: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.dto.ts`, `*.spec.ts`" |
| Lista de todos os arquivos | "Para novo endpoint: criar `src/<dominio>/<dominio>.controller.ts` + registrar em `<dominio>.module.ts`. Para nova migration: `src/migrations/YYYYMMDD-<descricao>.ts`" |

**Anti-padrões:** listar arquivos individualmente; omitir onde ficam os testes; não dizer onde adicionar código novo.

---

### TESTING.md — o guia de execução

**Deve conter:**
- Comandos exatos para: unit tests, integration tests, e2e, lint, format, typecheck
- Cobertura atual (se disponível no config ou CI)
- Frameworks: test runner, assertions, mocking, factories/builders
- Onde ficam os testes (pasta, convenção de nome)
- Como rodar um único teste/arquivo (ex.: `npx jest src/auth/auth.service.spec.ts`)
- Como rodar em watch mode
- **Pré-requisitos de ambiente** para integration/e2e (DB, Redis, serviços externos)
- Status do CI: arquivo de config, checks que rodam, tempo estimado

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Use npm test" | "`npm test` (unit, sem deps externas), `npm run test:e2e` (requer PostgreSQL :5432 + Redis :6379); arquivo único: `npx jest <path>` ; watch: `npx jest --watch`" |
| "Tem testes" | "Jest 29 + ts-jest; factories com `@faker-js/faker`; e2e via `@nestjs/testing` + `supertest` + banco real em Docker; cobertura alvo: 80%; CI: `.github/workflows/ci.yml`, ~4 min" |

**Anti-padrões:** não listar o que o comando faz; omitir pré-requisitos de ambiente; marcar "não verificado" sem tentar.

---

### INTEGRATIONS.md — o inventário de integrações

**Deve conter:**
- Para cada integração: nome, propósito, SDK/protocolo, variáveis de ambiente (sem valores)
- Bancos: tipo, conexão, env vars, tamanho de pool
- Auth externos: OAuth providers, SAML IdPs, env vars
- Filas/mensageria: broker, tópicos/queues, padrão (pub/sub, consumer group)
- APIs de terceiros: endpoint base, autenticação usada, rate limits conhecidos
- Webhooks: quais recebe e quais envia, endpoints
- Storage externo: serviço, env vars
- **Se não houver integrações externas:** escrever explicitamente "**Não detectado**" com contexto

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Usa banco de dados" | "**PostgreSQL 15** via TypeORM: env `DATABASE_URL` (connection string) + `DATABASE_SSL` (boolean); pool de 10 conexões; migrations em `src/migrations/`" |
| "Integra com pagamentos" | "**Stripe v14 SDK**: env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; fluxos: `checkout.session.create`, `customer.subscription.update`; webhooks em `POST /webhooks/stripe`" |

**Anti-padrões:** omitir nomes de env vars; dizer "integra com cloud" sem especificar; esquecer webhooks bidirecionais.

---

### CONVENTIONS.md — o guia de contribuição

**Deve conter:**
- Nomenclatura de arquivos (ex.: `kebab-case` para arquivos, `PascalCase` para classes)
- Nomenclatura de funções e variáveis
- Estrutura de módulos: como exportar, onde colocar tipos, como organizar imports
- **Padrão de erros/exceptions:** como lançar, como capturar, classes customizadas
- **Padrão de logging:** nível, formato, campos obrigatórios
- Validação de entrada: onde validar, qual biblioteca
- Comentários: quando escrever, quando não escrever
- Paths reais em backticks como evidência (não apenas regras abstratas)
- Desvios recorrentes detectados (padrões não-oficiais que existem no código)

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Use boas práticas" | "Erros: lançar `AppException` de `src/shared/exceptions/app.exception.ts` com `code` e `statusCode`; nunca lançar `Error` puro em código de domínio" |
| "Nomenclatura padrão" | "Arquivos: `kebab-case`; classes: `PascalCase`; interfaces: `PascalCase` sem prefixo `I`; constantes: `UPPER_SNAKE_CASE`; enums: `PascalCase`" |

**Anti-padrões:** inventar convenções não verificadas no código; omitir padrão de erros; ignorar desvios recorrentes que existem de fato.

---

### CONCERNS.md — o radar de risco

**Deve conter:**
- **Dívida técnica:** área, descrição, arquivo(s) em backtick, impacto (`low`/`medium`/`high`/`critical`)
- **Riscos de segurança:** vulnerabilidade potencial, onde está, mitigação sugerida
- **Riscos de desempenho:** ponto de gargalo, evidência, impacto
- **Dependências sensíveis:** lib com histórico de CVEs, lib abandonada, versão desatualizada com problema conhecido
- **Código frágil:** módulos sem testes, alta complexidade ciclomática, sem tipagem, acoplamento alto
- Não inventar concerns — apenas registrar evidências observadas (padrões, versões, ausência de testes)
- Cada item: **área**, **descrição**, **arquivo(s)** em backtick, **impacto**

| Ruim ❌ | Bom ✅ |
|---------|--------|
| "Tem alguns problemas" | "**[high] Sem validação em rotas admin:** `src/admin/admin.controller.ts:L45-L78` — nenhum DTO; qualquer payload aceito; risco de injection" |
| "Código legado" | "**[medium] `src/legacy/report-generator.ts`:** 800 linhas, 0 testes, `any` extensivo, última modificação há 2 anos; qualquer mudança é de alto risco" |

**Anti-padrões:** concerns genéricos sem arquivo/evidência; classificar tudo como `high`; omitir riscos de segurança detectados.

---

### Estratégia de cross-referência entre documentos

Os sete documentos complementam sem repetir. Use estas convenções:

| Quando A menciona... | B deve... |
|----------------------|-----------|
| OVERVIEW menciona módulo | STRUCTURE explicar onde está |
| STACK menciona dep crítica | CONCERNS mencionar se tem risco ou está desatualizada |
| INTEGRATIONS menciona integração | CONCERNS mencionar se tem ponto fraco ou env var ausente |
| CONVENTIONS menciona padrão | STRUCTURE mostrar onde ele é aplicado |
| TESTING menciona integração com banco | INTEGRATIONS já detalhou o banco |

**Regra:** ao escrever um documento, referenciar o irmão relevante com path em backtick. Ex.: em CONCERNS: "Ver `INTEGRATIONS.md` para detalhes de conexão."
</document_quality_guide>

<process>
1. Garantir pastas `.oxe/` e `.oxe/codebase/`.

2. **Carregar context pack:** ler `.oxe/context/packs/scan.md` e `.oxe/context/packs/scan.json` se existirem. Se fresco/coerente, usar como mapa primário. Se ausente/stale, registrar `fallback para leitura direta`.

3. **Inventariar o repo:** Glob/Grep para linguagens, manifests (`package.json`, `pom.xml`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `*.csproj`), pastas principais — aplicando foco/ignore da config.

3a. **Detecção arquitetural:** aplicar `<architectural_detection>` — classificar padrão dominante e domínios funcionais. Registrar em OVERVIEW.md.

3b. **Legado / brownfield:** se sinais de mainframe ou desktop legado (`*.cbl`, `*.jcl`, `*.cpy`, `*.frm`, `*.vbp`, volume de `*.sql` com procedures), aplicar **`oxe/workflows/references/legacy-brownfield.md`** ao preencher STACK, STRUCTURE, INTEGRATIONS, TESTING e CONCERNS.

3c. **Detecção de Azure:** se uso de Azure detectado (`@azure/*`, `com.microsoft.azure.*`, imports `azure.*`, env vars `AZURE_*`), registrar em INTEGRATIONS.md com serviços, versão SDK, env vars (sem valores). Provider `oxe-cc azure` é opt-in — apenas informativo.

3d. **Documentação humana:** se `docs/` ou `src/docs/` com índice existirem, resumir papel das subpastas em OVERVIEW e STRUCTURE e linkar o ficheiro índice.

4. **Produzir os sete documentos** em `.oxe/codebase/` (paralelizar sub-agentes quando disponível):
   - **OVERVIEW.md** — propósito, padrão arquitetural, domínios, fluxo principal, módulos
   - **STACK.md** — runtime, frameworks, deps críticas com versões, env vars chave
   - **STRUCTURE.md** — árvore lógica (máx 3 níveis), entrypoints, onde adicionar código
   - **TESTING.md** — comandos exatos, frameworks, pré-requisitos, CI
   - **INTEGRATIONS.md** — APIs, bancos, auth, filas, webhooks, storage
   - **CONVENTIONS.md** — nomenclatura, erros, logging, imports, validação
   - **CONCERNS.md** — dívida técnica com arquivo+impacto, riscos

   Aplicar `<document_quality_guide>` como rubrica para cada documento antes de finalizar.

5. Atualizar **`.oxe/STATE.md`**: `Data:` (ISO), fase `scan_complete`, próximo passo `oxe:spec` ou `oxe:plan` se já houver SPEC.

6. **Scale-adaptive** (ativo por padrão se não configurado):
   - Contar arquivos de código (excluindo `node_modules`, `dist`, `build`, `.git`).
   - **< 50 arquivos, < 10 deps** → sugerir `profile: "fast"`, scan completo em 1 passo.
   - **50–500 arquivos** → sugerir `profile: "balanced"` (padrão).
   - **> 500 arquivos ou legado** → sugerir `profile: "strict"`, considerar sub-agentes por módulo.
   - Se `profile` já configurado em `.oxe/config.json`: confirmar sem sugerir mudança.

7. **Paralelização de sub-agentes** (quando > 100 arquivos de código e sub-agentes disponíveis):
   - Sub-agente A: OVERVIEW + STACK (manifests, entrypoints, deps)
   - Sub-agente B: STRUCTURE + CONVENTIONS (organização de src/, linters, configs)
   - Sub-agente C: TESTING + INTEGRATIONS (specs, env vars, integrações externas)
   - Sub-agente D: CONCERNS (análise de código crítico, CVEs, dívida técnica)
   Consolidar e aplicar cross-referências após todos terminarem. OVERVIEW pode precisar de ajuste final após os outros.

8. Aplicar `<quality_gate>` — corrigir documentos que falham antes de finalizar.

9. Resumir no chat (5-10 linhas): padrão arquitetural detectado, domínios funcionais, profile recomendado, próximo passo sugerido, e concerns críticos se houver (máx 3 bullets).
</process>

<quality_gate>
## Gate de qualidade do scan

Percorrer este checklist antes de finalizar. Corrigir documentos que falham.

**Completude estrutural:**
- [ ] Os sete arquivos existem em `.oxe/codebase/` com conteúdo > 10 linhas cada
- [ ] Nenhum arquivo termina com `...` ou texto truncado
- [ ] Nenhum documento é uma lista genérica sem evidência de arquivo/versão

**OVERVIEW:**
- [ ] Padrão arquitetural declarado com ≥ 3 evidências (arquivos/pastas em backtick)
- [ ] Domínios funcionais listados (ou "nenhum detectado" explícito)
- [ ] Fluxo principal tem ≥ 5 steps concretos (o que acontece, não o que existe)

**STACK:**
- [ ] Runtime com versão exata
- [ ] Framework principal com versão exata
- [ ] ≥ 3 dependências críticas com versão e papel explicado

**STRUCTURE:**
- [ ] ≥ 1 entrypoint identificado com caminho de arquivo
- [ ] "Onde adicionar novo código" respondido para ≥ 2 tipos de mudança

**TESTING:**
- [ ] Comando de teste principal com path exato, ou marcado "não verificado: [motivo]"
- [ ] Pré-requisitos de ambiente listados (ou "nenhum" explícito)

**INTEGRATIONS:**
- [ ] Variáveis de ambiente nomeadas por integração, ou "Não detectado" explícito

**CONVENTIONS:**
- [ ] Padrão de erros/exceptions documentado com classe real ou "não padronizado"
- [ ] Nomenclatura de arquivos com exemplo real em backtick

**CONCERNS:**
- [ ] Cada item tem ≥ 1 arquivo em backtick como evidência
- [ ] Cada item tem impacto estimado (`low`/`medium`/`high`/`critical`)

**Cross-referências:**
- [ ] ≥ 3 cross-referências entre documentos com path em backtick

**STATE.md:**
- [ ] `Data:` preenchida em ISO (YYYY-MM-DD)
- [ ] Fase: `scan_complete`
- [ ] Próximo passo definido (`oxe:spec` ou `oxe:plan`)
</quality_gate>

<success_criteria>
- [ ] Os sete arquivos em `.oxe/codebase/` existem com conteúdo denso — cada documento passou pelo `<document_quality_guide>` correspondente.
- [ ] Padrão arquitetural e domínios funcionais detectados e documentados em OVERVIEW.md.
- [ ] Pelo menos 3 cross-referências entre documentos usando paths em backtick.
- [ ] Comandos em TESTING.md foram validados ou marcados "não verificado: [motivo]".
- [ ] `.oxe/STATE.md` com `Data:` preenchida, fase `scan_complete`, próximo passo definido.
- [ ] Gate de qualidade passou — ou lacunas documentadas explicitamente com justificativa.
</success_criteria>
