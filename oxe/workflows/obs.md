# OXE — Workflow: obs

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-execute`.
> Use: `/oxe-execute --note "sua observação"` para registrar durante a execução.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Registrar uma **observação contextual** em **`.oxe/OBSERVATIONS.md`** durante ou fora de uma execução. A observação é incorporada automaticamente nos próximos `/oxe-spec`, `/oxe-plan`, `/oxe-discuss` ou `/oxe-execute` sem necessidade de re-explicar.

**Princípio:** *observation-without-re-explaining* — registre em 1 request, receba o benefício em todos os workflows seguintes sem custo extra de requisição.

Entrada: texto livre com a observação (restrição, descoberta técnica, preferência, risco, decisão).
</objective>

<context>
- Pode ser chamado **a qualquer momento**: antes, durante ou após qualquer passo da trilha OXE.
- Não interrompe o fluxo em curso — a observação é armazenada e incorporada na próxima oportunidade.
- Se chamado **durante execute** (fase `executing` no STATE) com impacto `execute` ou `all`: classificar a severidade e responder adaptativamente — `blocking` interrompe a onda e requer resolução explícita; `adjustment` incorpora como restrição na onda atual sem bloquear; `info` aplica na próxima oportunidade.
- Ler **`.oxe/STATE.md`** para capturar o contexto automático (fase atual, tarefa ativa, workstream ativo).
- Resolver `active_session` conforme `oxe/workflows/references/session-path-resolution.md`. Com sessão ativa, `OBSERVATIONS.md` vive em `.oxe/<active_session>/execution/`; sem sessão ativa, manter `.oxe/`.
- Usar `oxe/templates/OBSERVATIONS.template.md` para criar o arquivo se ainda não existir.
</context>

<format_observations_md>
Arquivo: **`OBSERVATIONS.md`** no escopo resolvido da sessão

```markdown
# Observações OXE

| ID | Data | Contexto | Impacto | Severidade | Status |
|----|------|----------|---------|------------|--------|
| OBS-001 | 2026-04-04 | execute/T3 | spec, plan | adjustment | pendente |
| OBS-002 | 2026-04-04 | pós-spec | execute | info | incorporada → execute (2026-04-04) |

---

### OBS-001 — 2026-04-04 | execute/T3
**Impacto:** spec, plan
**Severidade:** adjustment
**Tipo:** new_constraint
**Afeta (spec):** R3, R5
**Afeta (plan):** T4, T7
**Status:** pendente

JWT expiration deve ser configurável via `JWT_EXPIRES_IN` env var, não hardcoded 7d.

---

### OBS-002 — 2026-04-04 | pós-spec
**Impacto:** execute
**Severidade:** info
**Status:** incorporada → execute (2026-04-04)

API deve retornar mensagens de erro em português do Brasil.
```

**IDs:** sequenciais `OBS-001`, `OBS-002`, … (continuar do último ID existente no arquivo).

**Impacto:** classificar automaticamente com base no conteúdo:

| Texto menciona | Impacto atribuído |
|----------------|------------------|
| Requisitos, critérios A*, escopo, SPEC | `spec` |
| Tarefas Tn, ondas, verificação, PLAN | `plan` |
| Implementação, arquivos de código, comportamento técnico | `execute` |
| Dois ou mais dos acima, ou restrição global | `all` |

Se ambíguo, usar `all` (princípio de maior abrangência).

- `spec` — afeta requisitos, critérios de aceite ou escopo
- `plan` — afeta tarefas, ondas, dependências ou verificação
- `execute` — afeta a implementação da tarefa atual ou próxima
- `all` — afeta múltiplas camadas

**Severidade:** classificar automaticamente com base no conteúdo:

| Texto menciona | Severidade |
|----------------|------------|
| Coverage %, threshold, CI falhou, pipeline, Actions, test failed, falha no build | `blocking` |
| Erro técnico, exception, versão incompatível, dependência ausente, requisito incompatível | `blocking` |
| "não pode", "proibido", "exige", novo requisito que afeta tarefas em andamento | `adjustment` |
| Preferência, restrição técnica, descoberta que exige ajuste em tarefas existentes | `adjustment` |
| Contexto adicional, observação informativa, descoberta sem impacto imediato | `info` |

Se ambíguo entre `blocking` e `adjustment`, usar `blocking` (princípio de segurança).

**Tipo:** classificar automaticamente (campo omitido quando nenhum padrão se aplica):

| Texto menciona | Tipo |
|----------------|------|
| Coverage, threshold, Actions, CI, pipeline, test pass/fail, build falhou | `ci_failure` |
| "não pode", "proibido", "exige", "requisito" | `new_constraint` |
| Erro, exception, versão incompatível, dependência, module not found | `technical_blocker` |

**CI-evidência** (somente quando `Tipo: ci_failure`): extrair e registrar na seção `### OBS-NNN`:
```
**CI-evidência:**
  coverage_pct: 87
  coverage_threshold: 90
  failing_files: [src/auth.ts, src/utils.ts]
  ci_run_url: https://github.com/...
  failing_tests: [nome do teste]
```
Campos não encontrados no texto são omitidos. Esta evidência é consumida por `/oxe-verify` como fonte para critérios A* de qualidade.

**Status lifecycle:** `pendente` → `incorporada → <workflow> (YYYY-MM-DD)`
</format_observations_md>

<process>
1. Ler **`.oxe/STATE.md`**: capturar `phase`, `last_task` ou tarefa ativa na onda, `active_workstream`.
2. Determinar o **próximo ID** (OBS-NNN): contar entradas existentes em `OBSERVATIONS.md` do escopo resolvido ou começar em OBS-001.
3. Classificar o **impacto** automaticamente com base no texto; se ambíguo, usar `all`.
3b. **Propagação automática de constraints:**
   - Se existir **`.oxe/SPEC.md`**: ler a tabela de requisitos (R-ID) e critérios (A*) e identificar quais são diretamente afetados pelo texto da observação. Registrar em `**Afeta (spec):**`.
   - Se existir **`.oxe/PLAN.md`**: ler as tarefas (Tn) e identificar quais podem precisar de ajuste no campo `Verificar` ou `Implementar`. Registrar em `**Afeta (plan):**`.
   - Se nenhum R-ID ou Tn identificável: registrar `**Afeta:** (a cruzar na próxima incorporação)`.
   - Esta propagação é automática e não requer input do usuário.
3c. Classificar a **severidade** automaticamente usando a tabela de `<format_observations_md>`. Registrar como campo `**Severidade:**` na seção `### OBS-NNN` e na coluna da tabela de índice. Se ambíguo entre `blocking` e `adjustment`, usar `blocking`.
3d. Classificar o **tipo** automaticamente (se identificável). Se `Tipo: ci_failure`, extrair evidências estruturadas do texto (`coverage_pct`, `coverage_threshold`, `failing_files`, `ci_run_url`, `failing_tests`) e registrar como `**CI-evidência:**` na seção `### OBS-NNN`. Omitir campos não encontrados.
4. Criar ou atualizar **`OBSERVATIONS.md`** no escopo resolvido:
   - Adicionar linha na tabela de índice.
   - Adicionar seção `### OBS-NNN` com contexto, impacto, status e texto.
5. Avaliar **urgência** e responder adaptativamente:
   - Se `phase` ∈ `{ executing, quick_active }` **e** impacto ∈ `{ execute, all }`:
     - **Se `Severidade: blocking`:**
       1. Identificar tarefas do PLAN que tocam os arquivos/áreas afetados (campo `**Afeta (plan):**`)
       2. Propor micro-ajustes alinhados ao plano: sub-tarefas dentro das tarefas existentes — não adicionar escopo novo
       3. Apresentar três opções ao usuário:
          - **A) Ajuste inline:** adicionar sub-tarefas à tarefa atual e retomar execução imediatamente
          - **B) Micro-replan:** pausar onda, atualizar PLAN.md com as sub-tarefas, retomar após confirmação
          - **C) Registrar apenas:** incorporar na próxima rodada sem interromper a onda atual
       4. Seja qual opção for escolhida: se `ACTIVE-RUN.json` existir, registrar `blocker_info: { obs_id, severity, type, affected_tasks }` e emitir evento em `OXE-EVENTS.ndjson` (tipo `obs_blocking`)
     - **Se `Severidade: adjustment`:**
       - Apresentar ao usuário: "Observação registrada (ajuste). Incorporar na onda atual ou na próxima?"
       - Se onda atual: incorporar imediatamente nas tarefas afetadas como restrição ou nota de implementação
       - Se próxima onda: confirmar que será incorporado automaticamente no início da próxima onda
     - **Se `Severidade: info`** (ou sem campo Severidade):
       - Confirmar registro; mencionar que será incorporado quando o workflow relevante for chamado
   - Em qualquer outro caso (fora de executing/quick_active): confirmar registro e mencionar quando será incorporado.
6. Atualizar **`.oxe/STATE.md`**: adicionar ou atualizar campo `obs_pendentes: true` (remover ou marcar `false` quando todos os OBS estiverem `incorporada`).
7. Responder no chat com: ID atribuído (OBS-NNN), impacto classificado, próximo passo sugerido (qual workflow incorporará a observação).
</process>

<auto_incorporation_rule>
Qualquer workflow que leia `.oxe/OBSERVATIONS.md` deve:
1. Verificar se há entradas com `Status: pendente` relevantes ao seu escopo de impacto.
2. Incorporar o conteúdo na lógica do workflow (enriquecer requisitos, ajustar tarefas, modificar implementação).
3. Após incorporar: atualizar a linha no índice e na seção `### OBS-NNN` para `incorporada → <workflow> (data)`.
4. Se `STATE.md` tiver `obs_pendentes: true` e todas as observações relevantes foram incorporadas: atualizar para `obs_pendentes: false`.

**Workflows que incorporam observações:**
- `/oxe-spec` (Fase 3 — Requisitos): impacto `spec` ou `all`
- `/oxe-plan`: impacto `plan` ou `all`
- `/oxe-discuss`: impacto `spec`, `plan` ou `all` (como contexto adicional)
- `/oxe-execute`: impacto `execute` ou `all` — incorporar no início da onda atual
</auto_incorporation_rule>

<success_criteria>
- [ ] `.oxe/OBSERVATIONS.md` existe com entrada OBS-NNN na tabela e seção de detalhe.
- [ ] Impacto classificado corretamente (spec | plan | execute | all).
- [ ] Severidade classificada corretamente (info | adjustment | blocking); campo presente na tabela e na seção `### OBS-NNN`.
- [ ] Tipo detectado e registrado quando padrão identificável; `CI-evidência` extraída se `Tipo: ci_failure`.
- [ ] `STATE.md` tem `obs_pendentes: true`.
- [ ] Se `Severidade: blocking` durante executing: opções A/B/C apresentadas ao usuário; `ACTIVE-RUN.json` atualizado com `blocker_info` se existir.
- [ ] Se `Severidade: adjustment` durante executing: usuário consultado sobre incorporar na onda atual ou na próxima.
- [ ] Resposta no chat inclui ID, impacto, severidade e próximo passo de incorporação.
</success_criteria>
