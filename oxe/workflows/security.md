# OXE — Workflow: security (auditoria de segurança)

<objective>
Produzir **`.oxe/SECURITY.md`**: auditoria de segurança do repositório focada nas categorias OWASP Top 10 **relevantes** ao stack do projeto. Complementa **`validate-gaps`** (cobertura de testes) com uma camada de segurança aplicativa.

Pode ser chamado standalone ou como Camada 5 do **`verify.md`** quando `config.json` tiver `"security_in_verify": true`.

Não substitui ferramentas de análise estática (SAST) — identifica padrões de risco no código e na configuração a partir do contexto disponível no repositório.
</objective>

<context>
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. O relatório de segurança segue a sessão ativa em `verification/`, mas continua a ler `codebase/` global.
- **Fonte de stack:** `.oxe/codebase/STACK.md` determina quais categorias OWASP são pertinentes (ex.: app sem DB descarta A03:Injection-SQL; API sem auth descarta A07:Authentication).
- **Fontes de código:** `.oxe/codebase/STRUCTURE.md`, `.oxe/codebase/CONCERNS.md`, `.oxe/codebase/INTEGRATIONS.md` orientam quais arquivos focar.
- **Severidade:** P0 = crítico (exploração provável, impacto direto), P1 = alto (requer mitigação antes do próximo deploy), P2 = médio (risco aceitável com compensação documentada).
- **Saída de tarefas:** recomendações vinculadas a `Tn` existentes no PLAN.md (se disponível) ou como sugestões de novas tarefas `T_new`.
- **Integração com verify:** se `security_in_verify: true` em `.oxe/config.json`, o workflow `verify.md` inclui referência a este output como Camada 5. O `security.md` continua sendo o workflow canônico.
- **Não alterar código:** apenas auditar e registrar achados. Nenhum arquivo de código é modificado.
</context>

<owasp_scope>
## Mapeamento OWASP → Stack

Antes de auditar, determinar quais categorias se aplicam lendo `STACK.md` e `INTEGRATIONS.md`:

| Categoria OWASP | Aplicável quando |
|-----------------|-----------------|
| A01 — Broken Access Control | App com autenticação/autorização ou rotas protegidas |
| A02 — Cryptographic Failures | Dados sensíveis em trânsito ou em repouso; senhas; tokens |
| A03 — Injection | DB queries, shell commands, parsers de entrada, templates |
| A04 — Insecure Design | Ausência de modelagem de ameaças; fluxos de negócio sem validação |
| A05 — Security Misconfiguration | Config de servidor, CORS, headers HTTP, variáveis de ambiente |
| A06 — Vulnerable Components | Dependências com CVEs conhecidos; versões sem suporte |
| A07 — Authentication Failures | Login, sessão, JWT, OAuth, tokens de reset |
| A08 — Software Integrity | Supply chain; checksums; CI/CD sem verificação |
| A09 — Logging & Monitoring | Ausência de logs de eventos críticos; dados sensíveis em logs |
| A10 — SSRF | Requisições a URLs controladas pelo usuário; fetch/proxy interno |

**Selecionar apenas as categorias aplicáveis** ao stack identificado. Listar explicitamente as ignoradas e o motivo.
</owasp_scope>

<process>
1. Ler `.oxe/codebase/STACK.md`, `.oxe/codebase/STRUCTURE.md`, `.oxe/codebase/INTEGRATIONS.md`, `.oxe/codebase/CONCERNS.md`.
2. Selecionar categorias OWASP aplicáveis ao stack (ver `<owasp_scope>`); registrar as descartadas.
3. Para cada categoria aplicável:
   a. Identificar **arquivos críticos** (auth, input handlers, DB queries, configs, env, deps).
   b. Ler os arquivos relevantes (Glob, Grep, Read) procurando padrões de risco.
   c. Registrar achados com: localização (`path:linha`), padrão encontrado, severidade (P0/P1/P2), recomendação.
4. Ler `PLAN.md` do escopo resolvido se existir — vincular achados P0/P1 a tarefas `Tn` existentes quando possível, ou criar sugestão `T_new`.
5. Escrever `SECURITY.md` no escopo resolvido a partir de `oxe/templates/SECURITY.template.md`.
6. Atualizar `.oxe/STATE.md`: nota de segurança (ex.: `security_audit: YYYY-MM-DD | P0:N | P1:N | P2:N`).
7. Responder no chat: total de achados por severidade, arquivos mais críticos identificados, próximo passo (P0 presentes → bloquear deploy; apenas P2 → ação opcional).
</process>

<success_criteria>
- [ ] `SECURITY.md` existe no escopo correto com categorias OWASP selecionadas e justificativa de descarte.
- [ ] Cada achado tem: localização, padrão, severidade, recomendação.
- [ ] Categorias sem achados registradas como "nenhum achado nesta categoria".
- [ ] Achados P0/P1 vinculados a `Tn` existente ou sugestão `T_new`.
- [ ] Nenhum arquivo de código foi modificado.
- [ ] STATE.md tem linha `security_audit` com data e contagem de achados.
</success_criteria>
