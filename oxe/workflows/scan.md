# OXE — Workflow: scan

<objective>
Analisar o codebase e produzir documentação **estruturada e enxuta** em `.oxe/codebase/`, atualizando `.oxe/STATE.md`. Cada documento deve ser navegável por humanos e por agentes sem carregar o repo inteiro no contexto.

**Foco opcional:** se o utilizador indicar uma área (ex. `api`, `auth`), priorizar essa pasta ou módulo nos mapeamentos.
</objective>

<context>
- Diretório de saída: **`.oxe/`** na raiz do projeto (não `.planning/`).
- Se `.oxe/` não existir, criar.
- Carregar `oxe/templates/STATE.md` como base se `STATE.md` ainda não existir; caso exista, preservar histórico útil e atualizar seção **Último scan** e **Fase**.
- Não apagar `SPEC.md` / `PLAN.md` se já existirem — apenas atualizar codebase.
</context>

<process>
1. Garantir pastas `.oxe/` e `.oxe/codebase/`.
2. Inventariar o repo (Glob/Grep): linguagens, manifests (`package.json`, `pom.xml`, `go.mod`, etc.), pastas principais.
3. Produzir **quatro** arquivos em `.oxe/codebase/` (paralelize subagentes quando disponível):
   - **OVERVIEW.md** — propósito aparente do projeto, módulos de alto nível, fluxo principal (5–15 tópicos).
   - **STACK.md** — runtime, frameworks, build, versões relevantes, dependências críticas.
   - **STRUCTURE.md** — árvore lógica (não listar mil arquivos): entrypoints, `src/` por domínio, onde ficam testes e configs.
   - **TESTING.md** — como rodar testes/lint/format (comandos exatos), frameworks de teste, pastas `*test*`, CI se houver.
4. Atualizar **`.oxe/STATE.md`**: data do scan, fase sugerida `scan_complete`, próximo passo recomendado `oxe:spec` ou `oxe:plan` se já houver SPEC.
5. Resumir em 5–10 linhas no chat: o que foi escrito e o próximo passo sugerido.
</process>

<success_criteria>
- [ ] `.oxe/codebase/OVERVIEW.md`, `STACK.md`, `STRUCTURE.md`, `TESTING.md` existem e têm conteúdo útil.
- [ ] `.oxe/STATE.md` reflete último scan e próximo passo.
- [ ] Comandos de teste em TESTING.md foram validados ou marcados como “não verificado” se o ambiente não permitir rodar.
</success_criteria>
