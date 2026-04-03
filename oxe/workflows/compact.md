# OXE — Workflow: compact

<objective>
**Atualizar o conhecimento do projeto em disco** de forma **rotineira**, sem depender de limites de chat, tokens ou ferramentas específicas.

Em cada execução:

1. **Comparar** o que está documentado em **`.oxe/codebase/*.md`** com o **repositório atual** (estrutura, stack, testes, integrações, convenções, riscos).
2. **Atualizar** os **sete** ficheiros em **`.oxe/codebase/`** (mesmos nomes e propósito que em **`scan.md`**) — **incrementalmente** quando já existirem conteúdos úteis; **geração completa** alinhada a **`scan.md`** (passos 2–4, incluindo **2b** legado e **2c** docs) quando faltarem ficheiros ou estiverem claramente vazios/inúteis.
3. Escrever **`.oxe/CODEBASE-DELTA.md`**: registo **estruturado** do que mudou **na documentação do codebase** face à versão anterior (o “diff” legível para humanos e agentes).
4. Reescrever **`.oxe/RESUME.md`** com a **trilha OXE** (fase, SPEC/PLAN, decisões, bloqueios) **e** um resumo de **1–3 linhas** a apontar para o delta e para os mapas atualizados.

**Não** é “compactar conversa”. **Não** apaga nem substitui `SPEC.md`, `PLAN.md`, `VERIFY.md`.
</objective>

<context>
- **Escopo:** projeto inteiro, **longo prazo**, foco em **conhecimento** e documentação estruturada — contrasta com **`checkpoint.md`** (sessão atual, curto prazo, progresso, snapshot nomeado). Ver tabela em **`help.md`** (secção *Checkpoint vs compact*).
- **Relação com scan:** **`/oxe-scan`** continua a ser o passo forte após clonar ou quando o repo **mudou por completo**. **`/oxe-compact`** evita correr scan “por hábito”: reutiliza o que já está em `codebase/` e **corrige só o que divergiu** do código real, salvo bootstrap quando não há base.
- **Exemplo canónico (upgrade de stack):** o **scan** fixou **Angular 17** em **`STACK.md`** (e possivelmente **TESTING.md** / **CONVENTIONS.md**). A equipa **implementou** a migração para **Angular 21** (`package.json`, `angular.json`, APIs novas, eventualmente standalone/signals). O **compact** compara esses mapas ao estado **atual** do repo e **atualiza** as secções desatualizadas (versões, comandos de build/teste, padrões recomendados), em vez de ignorar um mapa “antigo” ou refazer um scan completo só porque a versão mudou. O **`CODEBASE-DELTA.md`** deve registar explicitamente o salto de major (ex.: STACK: Angular 17 → 21) e o que mais foi tocado na documentação.
- Respeitar **`.oxe/config.json`**: `scan_focus_globs` / `scan_ignore_globs` como em **`scan.md`**.
- Templates: **`oxe/templates/RESUME.template.md`**, **`oxe/templates/CODEBASE-DELTA.template.md`**.
- **RESUME.md:** máximo **~120 linhas**; detalhe do codebase fica nos **sete** ficheiros + **CODEBASE-DELTA.md**.
- Segurança: não copiar segredos nem valores de env.
</context>

<process>
1. Garantir **`.oxe/`** e **`.oxe/codebase/`**.
2. Ler os **sete** ficheiros existentes em **`.oxe/codebase/`** (se houver): `OVERVIEW.md`, `STACK.md`, `STRUCTURE.md`, `TESTING.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `CONCERNS.md`. Guardar mentalmente (ou nota curta) o **estado anterior** para o delta.
3. **Inventariar o repo** atual (Glob/Grep): manifests, linguagens, pastas principais — com foco/ignore da config.
4. **Decisão:**
   - Se **algum** dos sete ficheiros **falta** ou o conjunto é **óbvio que não descreve** o repo → seguir **processo completo** de **`scan.md`** (passos 2–4: produção dos sete ficheiros + atualização de **`.oxe/STATE.md`** com **Data** do scan e fase sugerida). Depois continuar no passo 6.
   - Caso contrário → para **cada** um dos sete ficheiros, **atualizar só secções** onde o repo **diverge** do texto atual — incluindo **versões** em manifests (`package.json`, `pom.xml`, etc.), **comandos** de CI/local, **frameworks** (ex.: major bump Angular), novos módulos, integrações, convenções e dívida. Preservar estrutura e links úteis; remover ou marcar como *obsoleto* apenas o que o código já não reflete.
5. Atualizar **`.oxe/STATE.md`**: preencher ou atualizar o bloco **Último compact (codebase + RESUME)** (ver `oxe/templates/STATE.md`; data ISO **YYYY-MM-DD**, nota opcional). **Não** apagar **Último scan** — o compact **complementa** o scan; se no passo 4 correu equivalente a scan completo, a **Data** em **Último scan** deve refletir essa atualização (como em **`scan.md`**).
6. Criar ou **substituir** **`.oxe/CODEBASE-DELTA.md`** com o template: **resumo**, **alterações por ficheiro** (adicionado / alterado / removido na **documentação**), **lacunas** (o que ainda não foi verificado no repo).
7. Criar ou **substituir** **`.oxe/RESUME.md`** a partir do template (incluir secção **Codebase** com link a **`CODEBASE-DELTA.md`** e data do refresh).
8. Responder no chat em **≤8 linhas:** confirmar paths **`.oxe/codebase/*.md`**, **`.oxe/CODEBASE-DELTA.md`**, **`.oxe/RESUME.md`**; **uma** frase sobre o maior delta; lembrar que **`/oxe-checkpoint`** serve para **marco de sessão**, não para este refresh global.
</process>

<success_criteria>
- [ ] Os **sete** ficheiros em **`.oxe/codebase/`** existem e refletem o repo **atual** (ou foi explicitamente marcado *não verificado* onde o ambiente impedir).
- [ ] **`.oxe/CODEBASE-DELTA.md`** descreve claramente o que mudou face à documentação anterior.
- [ ] **`.oxe/RESUME.md`** está alinhado à trilha OXE e aponta para o delta.
- [ ] Nenhum contrato canónico (SPEC/PLAN/VERIFY) foi removido.
</success_criteria>
