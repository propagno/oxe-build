# OXE — Workflow: ship (entrega / commit)

<objective>
Criar um commit local a partir do trabalho verificado — gerando a mensagem de commit a partir de `SPEC.md`, `PLAN.md` e `VERIFY.md` e chamando `git commit`.

Fecha o ciclo de desenvolvimento com um commit limpo, rastreável e alinhado aos artefatos OXE.
</objective>

<flags>
- `--message "mensagem"` — sobrescreve a mensagem de commit gerada automaticamente.
- `--amend` — usa `git commit --amend` em vez de criar um commit novo.
- `--verify-first` — rodar `/oxe-verify` antes de criar o PR se VERIFY ainda não passou.
- `--no-checks` — pular checagem de verify (commitar mesmo sem verify completo — gera aviso).
- `--dry-run` — mostrar a mensagem de commit e o comando `git commit` sem commitar.
</flags>

<context>
- Ship requer que `VERIFY.md` exista e indique aprovação, OU que o usuário confirme explicitamente com `--no-checks`.
- A mensagem de commit é gerada a partir dos artefatos OXE — não a partir do histórico git cru.
- Salvar o rascunho da mensagem em `.oxe/commit-draft.md`.
- Salvar referência do commit em `.oxe/commit-record.json` após commitar.
- Se houver alterações não relacionadas no worktree, pausar e pedir confirmação antes de stagear tudo.
</context>

<process>

### Step 1 — Pré-voo

1. Ler `.oxe/STATE.md` e sessão ativa (se houver).
2. Verificar branch atual: `git branch --show-current`.
3. Verificar status do verify:
   - Existe `VERIFY.md` e está aprovado? → continuar.
   - Existe `VERIFY.md` mas tem falhas? → avisar. Se `--no-checks`, continuar. Se não, sugerir `/oxe-verify` primeiro.
   - Não existe `VERIFY.md`? → se `--verify-first`, executar `oxe/workflows/verify.md` antes de continuar. Caso contrário: bloquear a entrega e orientar `/oxe-verify` ou `--no-checks`.

4. Verificar worktree (`git status --short`):
   - Se não houver mudanças staged ou unstaged: informar que não há nada para commitar e encerrar.
   - Se houver mudanças fora do escopo planejado: avisar e pedir confirmação antes de prosseguir.

### Step 2 — Gerar mensagem de commit

Ler os artefatos disponíveis nesta ordem de prioridade:
1. `SPEC.md` (ou `QUICK.md` se for quick task) → objetivo / resumo curto
2. `PLAN.md` → tarefas concluídas / ondas fechadas
3. `VERIFY.md` → checks passados, evidências, riscos residuais
4. `CONCERNS.md` ou `SUMMARY.md` → notas adicionais se houver

Template da mensagem:
```markdown
feat: <descrição concisa em <= 72 chars>

<Resumo de 1-2 parágrafos derivado de SPEC/QUICK e PLAN>

Validation:
- <check 1>
- <check 2>

---
OXE: spec-driven workflow
```

Gerar também uma variante `fix:` ou `refactor:` quando os artefatos indicarem esse tipo de mudança. Se `--message` existir, usá-la como título e manter o corpo gerado abaixo.

Salvar a mensagem em `.oxe/commit-draft.md`.

### Step 3 — Stage e commit

1. Fazer stage explícito:
   - padrão: `git add -A`
   - se houver arquivos claramente fora do escopo, parar e confirmar antes
2. Executar:
   - commit novo:
     ```bash
     git commit -F .oxe/commit-draft.md
     ```
   - amend:
     ```bash
     git commit --amend -F .oxe/commit-draft.md
     ```

Salvar em `.oxe/commit-record.json`:
```json
{
  "commit_sha": "<sha>",
  "subject": "...",
  "amend": false,
  "committed_at": "ISO",
  "branch": "...",
  "verify_status": "passed|skipped|failed_with_override"
}
```

Se `git commit` falhar por hooks, conflitos ou falta de stage válido:
- registrar o erro
- não apagar `.oxe/commit-draft.md`
- reportar o bloqueio com o comando falhado

### Step 4 — Saída final

**Sucesso:**
```
✓ Commit criado: [sha-curto]
Branch: [current]
Mensagem: [subject]
Próximo: push manual, revisão de diff ou /oxe-session milestone (se for a última feature do ciclo)
```

**Dry-run:**
```
[dry-run] Commit não criado. Mensagem gerada em .oxe/commit-draft.md
Comando para commitar: git commit -F .oxe/commit-draft.md
```

**Falha / bloqueio:**
```
Commit não realizado. Rascunho mantido em .oxe/commit-draft.md
Resolva o bloqueio (verify, stage, hook ou conflito) e rode /oxe-ship novamente.
```
</process>

<message_generation>
## Geração automática da mensagem

O subject é gerado a partir de `SPEC.md` (primeira linha de objetivo) ou de `QUICK.md` (primeira tarefa):

Formato padrão: `feat: [descrição concisa da feature em ≤ 72 chars]`

Exemplos:
- `feat: add OAuth2 login with Google provider`
- `fix: resolve race condition in payment processor`
- `refactor: extract auth middleware to standalone module`

Se houver ticket/issue referenciado na SPEC: `feat(AUTH-123): add OAuth2 login`
</message_generation>

<success_criteria>
- [ ] Commit criado (ou dry-run mostrou a mensagem e o comando).
- [ ] `.oxe/commit-record.json` atualizado com SHA e subject.
- [ ] Mensagem de commit inclui resumo derivado de SPEC/QUICK, mudanças de PLAN e validação de VERIFY.
- [ ] Se VERIFY não passou: só continuou com `--no-checks`, com aviso explícito.
- [ ] Sugeriu próximo passo (push, revisão de diff ou milestone).
</success_criteria>
