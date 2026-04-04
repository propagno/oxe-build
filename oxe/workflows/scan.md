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
- Entre scans completos, **`compact.md`** (`/oxe-compact`) pode **atualizar incrementalmente** os mesmos sete ficheiros em `.oxe/codebase/` comparando-os ao repo e registar mudanças em **`CODEBASE-DELTA.md`**. Caso típico: o scan descreveu **Angular 17** (ou outra stack) e o projeto **já foi migrado** na implementação (ex.: **Angular 21**) — o **compact** alinha **`STACK.md`** (e ficheiros relacionados) ao que está **implementado agora**, sem apagar o trabalho útil do scan anterior.

</context>

<mode_detection>
## Detecção automática de modo: bootstrap vs refresh

Antes de iniciar, verificar se `.oxe/codebase/` já existe com os sete mapas:

- **Modo bootstrap** (padrão quando codebase/ não existe ou está incompleto): produzir os sete arquivos do zero. Comportamento descrito no `<process>` abaixo.
- **Modo refresh** (quando codebase/ existe e tem os sete mapas): executar a lógica de `oxe/workflows/compact.md` — comparar mapas existentes ao repo atual, atualizar incrementalmente, produzir `CODEBASE-DELTA.md` e `RESUME.md`. **Não refazer do zero.**

Flag `--full`: forçar modo bootstrap mesmo se codebase/ existir.
Flag `--refresh`: forçar modo refresh.

**Sem flag:** automático por contexto. Se os mapas existem e o último scan foi há menos de `scan_max_age_days` (config), sugerir refresh mas perguntar ao usuário antes de executar o scan completo.
</mode_detection>

<process>
1. Garantir pastas `.oxe/` e `.oxe/codebase/`.
2. Inventariar o repo (Glob/Grep): linguagens, manifests (`package.json`, `pom.xml`, `go.mod`, etc.), pastas principais — aplicando foco/ignore da config se houver.
2b. **Legado / brownfield:** se o inventário revelar sinais de mainframe ou desktop legado (ex.: `*.cbl`, `*.jcl`, pastas `jcl/`, `cpy/` ou `copy/`, `*.cpy`, `*.frm` / `*.vbp`, volume de `*.sql` com procedures), aplicar **`oxe/workflows/references/legacy-brownfield.md`** ao preencher STACK, STRUCTURE, INTEGRATIONS, TESTING e CONCERNS — **sem** assumir Node/Java nem omitir TESTING.md quando não houver CI.
2c. **`docs/` / `src/docs/` com documentação humana:** se existir pasta de documentação com índice (`docs/INDICE-GERAL.md`, `docs/README.md`, `**/00-*INDICE*.md`, ou enciclopédia por camadas), em **OVERVIEW** e **STRUCTURE** resumir o **papel das subpastas** (ex.: `tecnico/`, `negocio/`, `glossary/`, comparativos, baixa plataforma) e linkar o ficheiro índice em backticks. Em **INTEGRATIONS** (e se útil em OVERVIEW), quando o repo for híbrido host + distribuído + externos, incluir bullets **Alta plataforma**, **Baixa plataforma**, **Externo** conforme `legacy-brownfield.md`. Sugerir template opcional `oxe/templates/DOCS_BROWNFIELD_LAYOUT.md` ao utilizador se a árvore `docs/` estiver em crescimento.
3. Produzir **sete** arquivos em `.oxe/codebase/` (paralelize subagentes quando disponível):
   - **OVERVIEW.md** — propósito aparente do projeto, módulos de alto nível, fluxo principal (5–15 tópicos); se houver índice em `docs/`, um tópico deve apontar para ele.
   - **STACK.md** — runtime, frameworks, build, versões relevantes, dependências críticas.
   - **STRUCTURE.md** — árvore lógica (não listar mil arquivos): entrypoints, `src/` por domínio, onde ficam testes e configs; **e** papel de `docs/` ou `src/docs/` quando existirem.
   - **TESTING.md** — como rodar testes/lint/format (comandos exatos), frameworks de teste, pastas `*test*`, CI se houver.
   - **INTEGRATIONS.md** — APIs externas, bancos, auth, filas, segredos (nomes de env **sem valores**), webhooks; em sistemas legado híbridos, taxonomia alta/baixa/externo quando aplicável. Se não houver integrações, escrever explicitamente *Não detectado* com uma linha de contexto.
   - **CONVENTIONS.md** — estilo de código (naming, formatação, imports), padrões de erros/logging, organização de módulos; **prescreve** o que seguir em novas alterações (com paths em backticks).
   - **CONCERNS.md** — dívida técnica, áreas frágeis, riscos de segurança/desempenho, dependências sensíveis; cada item com impacto breve e **arquivos** referenciados.
4. Atualizar **`.oxe/STATE.md`**: **Data** do scan (ISO), fase sugerida `scan_complete`, próximo passo `oxe:spec` ou `oxe:plan` se já houver SPEC.
5. **Scale-adaptive** (se `scale_adaptive: true` em `.oxe/config.json` ou não configurado — ativo por padrão):
   - Contar arquivos de código (excluindo `node_modules`, `dist`, `build`).
   - Contar dependências diretas (se houver `package.json`, `pom.xml`, `go.mod`, etc.).
   - Sugerir profile adequado no chat:
     - **< 50 arquivos, < 10 dependências** → sugerir `profile: "fast"` no config.
     - **50–500 arquivos** → sugerir `profile: "balanced"` (padrão).
     - **> 500 arquivos ou sistema legado** → sugerir `profile: "strict"`.
   - Se já houver `profile` no `.oxe/config.json`, não sugerir mudança — apenas confirmar.
6. Resumir em 5–10 linhas no chat: o que foi escrito, o próximo passo sugerido, e (se scale-adaptive ativo) o profile recomendado.
</process>

<success_criteria>
- [ ] Os sete arquivos em `.oxe/codebase/` existem e têm conteúdo útil.
- [ ] `.oxe/STATE.md` reflete último scan (com **Data** preenchida quando possível) e próximo passo.
- [ ] Comandos de teste em TESTING.md foram validados ou marcados como “não verificado” se o ambiente não permitir rodar.
</success_criteria>
