# OXE — Workflow: scan

<objective>
Analisar o codebase e produzir documentação **estruturada e enxuta** em `.oxe/codebase/`, atualizando `.oxe/STATE.md`. Cada documento deve ser navegável por humanos e por agentes sem carregar o repositório inteiro no contexto.

**Foco opcional:** se o usuário indicar uma área (ex.: `api`, `auth`), priorizar essa pasta ou módulo nos mapeamentos.

Se **`.oxe/config.json`** tiver `scan_focus_globs` ou `scan_ignore_globs`, **priorizar** os caminhos do foco e **reduzir detalhe** nas áreas ignoradas (ainda assim mencionar que existem).
</objective>

<context>
- Diretório de saída: **`.oxe/`** na raiz do projeto (não `.planning/`).
- Se `.oxe/` não existir, criar.
- Carregar `oxe/templates/STATE.md` (ou `.oxe` relativo aos workflows instalados) como base se `STATE.md` ainda não existir; se existir, preservar histórico útil e atualizar **Último scan** (campo **Data:** em formato ISO **YYYY-MM-DD** quando possível, para o `oxe-cc doctor` calcular scan antigo) e **Fase**.
- Se existir **`.oxe/config.json`**, respeitar preferências documentadas em `oxe/templates/CONFIG.md`; **não** sobrescrever o arquivo no scan.
- Não apagar `SPEC.md` / `PLAN.md` se já existirem — apenas atualizar o codebase.
</context>

<process>
1. Garantir pastas `.oxe/` e `.oxe/codebase/`.
2. Inventariar o repo (Glob/Grep): linguagens, manifests (`package.json`, `pom.xml`, `go.mod`, etc.), pastas principais — aplicando foco/ignore da config se houver.
3. Produzir **sete** arquivos em `.oxe/codebase/` (paralelize subagentes quando disponível):
   - **OVERVIEW.md** — propósito aparente do projeto, módulos de alto nível, fluxo principal (5–15 tópicos).
   - **STACK.md** — runtime, frameworks, build, versões relevantes, dependências críticas.
   - **STRUCTURE.md** — árvore lógica (não listar mil arquivos): entrypoints, `src/` por domínio, onde ficam testes e configs.
   - **TESTING.md** — como rodar testes/lint/format (comandos exatos), frameworks de teste, pastas `*test*`, CI se houver.
   - **INTEGRATIONS.md** — APIs externas, bancos, auth, filas, segredos (nomes de env **sem valores**), webhooks. Se não houver integrações, escrever explicitamente *Não detectado* com uma linha de contexto.
   - **CONVENTIONS.md** — estilo de código (naming, formatação, imports), padrões de erros/logging, organização de módulos; **prescreve** o que seguir em novas alterações (com paths em backticks).
   - **CONCERNS.md** — dívida técnica, áreas frágeis, riscos de segurança/desempenho, dependências sensíveis; cada item com impacto breve e **arquivos** referenciados.
4. Atualizar **`.oxe/STATE.md`**: **Data** do scan (ISO), fase sugerida `scan_complete`, próximo passo `oxe:spec` ou `oxe:plan` se já houver SPEC.
5. Resumir em 5–10 linhas no chat: o que foi escrito e o próximo passo sugerido.
</process>

<success_criteria>
- [ ] Os sete arquivos em `.oxe/codebase/` existem e têm conteúdo útil.
- [ ] `.oxe/STATE.md` reflete último scan (com **Data** preenchida quando possível) e próximo passo.
- [ ] Comandos de teste em TESTING.md foram validados ou marcados como “não verificado” se o ambiente não permitir rodar.
</success_criteria>
