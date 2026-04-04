# OXE — Workflow: workstream

<objective>
Gerenciar **trilhas de desenvolvimento paralelas** dentro do mesmo projeto. Cada workstream tem seu próprio ciclo SPEC → PLAN → EXECUTE → VERIFY independente, sem interferir no pipeline principal.

Subcomandos:
- `/oxe-workstream list` — listar workstreams ativos.
- `/oxe-workstream new <nome>` — criar novo workstream.
- `/oxe-workstream switch <nome>` — definir workstream ativo no contexto atual.
- `/oxe-workstream status [nome]` — exibir status de um workstream.
- `/oxe-workstream close <nome>` — fechar workstream e mesclar contexto ao pipeline principal.
</objective>

<context>
**Por que workstreams?**

O pipeline OXE padrão (`.oxe/SPEC.md`, `PLAN.md`, etc.) é linear — uma entrega por vez. Workstreams permitem:
- Desenvolvimento de features paralelas sem sobrescrever artefatos.
- Trabalho em `bugfix/auth` e `feature/billing` simultaneamente.
- Times menores trabalhando em trilhas independentes com contextos separados.

**Estrutura no disco:**
```
.oxe/
  workstreams/
    <nome>/
      SPEC.md
      PLAN.md
      VERIFY.md
      DISCUSS.md      (opcional)
      STATE.md        (estado local da trilha)
      config.json     (herda do config principal; pode sobrescrever keys)
```

**Compatibilidade:**
- O pipeline principal (`.oxe/SPEC.md`, `.oxe/PLAN.md`, etc.) continua funcionando normalmente.
- Workstreams **não** substituem o pipeline principal — são adicionais.
- `oxe-cc doctor` e `oxe-cc status` reportam cada workstream separadamente quando `--workstream=<nome>` for passado.
- A seção **Workstreams ativos** do STATE.md principal lista os workstreams em andamento.
</context>

<process_list>
**`/oxe-workstream list`**

1. Ler `.oxe/workstreams/` — listar subpastas.
2. Para cada workstream, ler seu `STATE.md` local (fase e próximo passo).
3. Exibir tabela no chat: Nome | Fase | Próximo passo | Última atividade.
</process_list>

<process_new>
**`/oxe-workstream new <nome>`**

1. Validar que `<nome>` é um slug seguro (letras, números, hífens — sem espaços ou caracteres especiais).
2. Criar `.oxe/workstreams/<nome>/STATE.md` a partir de `oxe/templates/STATE.md`.
3. Criar `.oxe/workstreams/<nome>/config.json` vazio (herda do config principal).
4. Atualizar **STATE.md principal**: adicionar `<nome>` na seção **Workstreams ativos**.
5. Confirmar no chat: `Workstream '<nome>' criado. Próximo passo: /oxe-spec (no contexto do workstream)`.

**Convenção:** para operar em um workstream, prefixar os artefatos com `--workstream=<nome>` ou ativar com `/oxe-workstream switch <nome>`.
</process_new>

<process_switch>
**`/oxe-workstream switch <nome>`**

1. Verificar que `.oxe/workstreams/<nome>/` existe.
2. Atualizar STATE.md principal: seção **Workstream ativo** com nome.
3. Confirmar no chat: `Workstream ativo: <nome>. Artefatos em .oxe/workstreams/<nome>/`.

Após ativar, os workflows `/oxe-spec`, `/oxe-plan`, `/oxe-execute`, `/oxe-verify` operam nos artefatos do workstream ativo em vez dos artefatos raiz.
</process_switch>

<process_status>
**`/oxe-workstream status [nome]`**

1. Se `nome` omitido: usar workstream ativo do STATE.md.
2. Ler `.oxe/workstreams/<nome>/STATE.md` — fase e próximo passo.
3. Ler SPEC, PLAN, VERIFY do workstream (se existirem).
4. Exibir resumo: fase, critérios, gaps, próximo passo.
</process_status>

<process_close>
**`/oxe-workstream close <nome>`**

1. Verificar que o workstream está com `verify_complete` no seu STATE.md local.
2. Se não estiver: alertar e pedir confirmação com `--force`.
3. Mover (ou arquivar) `.oxe/workstreams/<nome>/` → `.oxe/workstreams/closed/<nome>-YYYY-MM-DD/`.
4. Atualizar STATE.md principal: remover `<nome>` de **Workstreams ativos**, registrar em **Workstreams encerrados**.
5. Confirmar no chat: `Workstream '<nome>' encerrado. Artefatos em .oxe/workstreams/closed/`.
</process_close>

<success_criteria>
- [ ] `.oxe/workstreams/<nome>/` existe com STATE.md local.
- [ ] STATE.md principal lista workstream na seção **Workstreams ativos**.
- [ ] Workflows OXE operam no workstream ativo quando configurado.
- [ ] Ao encerrar: artefatos arquivados e STATE principal atualizado.
</success_criteria>
