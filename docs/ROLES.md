# OXE — Guia por Papel

Cada papel interage com o OXE de uma forma diferente. Este guia resume o que cada pessoa precisa ler, decidir e — importante — o que pode ignorar.

---

## Executor

**Quem é:** Developer implementando a feature ou fix do ciclo atual.

**O que lê:**
- `.oxe/PLAN.md` — ondas, tarefas, hipóteses críticas, arquivos-alvo
- `.oxe/SPEC.md` — critérios de aceite (o que constitui "pronto")
- `.oxe/STATE.md` — fase atual e próximo passo recomendado

**O que decide:**
- Quando uma tarefa está concluída (marcar `[x]` ou deixar o executor marcar via `/oxe-execute`)
- Se uma hipótese crítica não pode ser verificada → escalar via `/oxe-debug`
- Se o plano precisa ser refeito → comunicar e rodar `/oxe-plan` novamente

**O que não precisa conhecer:**
- Detalhes do VERIFY.md (responsabilidade do reviewer)
- Configuração de gates e promoção (responsabilidade do operador)
- Funcionamento interno do runtime TypeScript

**Comandos principais:**
```
/oxe-execute   → executa a onda atual
/oxe-execute --task T3  → executa tarefa específica
/oxe-debug     → diagnóstico quando travado
/oxe-quick     → ciclo completo para tarefas S/M
```

---

## Reviewer

**Quem é:** Developer ou tech lead validando o que foi implementado.

**O que lê:**
- `.oxe/SPEC.md` — critérios de aceite para comparar com a implementação
- `.oxe/VERIFY.md` — resultado da verificação gerada pelo `/oxe-verify`
- Código e testes produzidos no ciclo

**O que decide:**
- Se os critérios A* foram atendidos
- Se há riscos residuais que bloqueiam a promoção
- Se é necessário um novo ciclo (respec, replan, re-execute)

**O que não precisa conhecer:**
- Detalhes de implementação de cada tarefa do PLAN.md
- Configuração de runtime, gates ou sessions

**Comandos principais:**
```
/oxe-verify         → valida critérios do SPEC contra evidências
/oxe-verify --audit → auditoria adversarial (sem acesso ao PLAN)
/oxe-review-pr      → revisão de PR/branch externo
```

---

## Operador de Gate / Incidente

**Quem é:** Tech lead ou SRE responsável por aprovar promoções e resolver bloqueios operacionais.

**O que lê:**
- `npx oxe-cc runtime gates list --dir .` — fila de gates pendentes
- `.oxe/runs/<run_id>/residual-risks.json` — riscos residuais da run
- `npx oxe-cc status --full` — estado operacional completo
- [`docs/INCIDENT-PLAYBOOK.md`](INCIDENT-PLAYBOOK.md) — guia de resolução

**O que decide:**
- Aprovar, rejeitar ou dispensar (`waive`) cada gate
- Quando disparar `runtime recover` vs. `runtime replay`
- Quando promover para `pr_draft` ou bloquear a promoção

**O que não precisa conhecer:**
- Detalhes do PLAN.md ou quais tarefas foram implementadas
- Semântica de raciocínio dos workflows

**Comandos principais:**
```bash
npx oxe-cc runtime gates list --dir .
npx oxe-cc runtime gates resolve --dir . --gate <id> --decision approve --actor <nome>
npx oxe-cc runtime promote --dir . --target pr_draft
npx oxe-cc runtime recover --dir . --run-id <id>
npx oxe-cc status --full
```

---

## Mantenedor do Pacote

**Quem é:** Responsável por publicar novas versões do `oxe-cc` no npm.

**O que lê:**
- `CHANGELOG.md` — deve ter entrada para a nova versão antes de publicar
- `README.md` — badge de versão deve estar atualizado
- `package.json` — `version` alinhado com tag git e CHANGELOG
- `.github/workflows/release.yml` — pipeline de publicação automatizada

**O que decide:**
- Qual semver bump aplicar (major/minor/patch)
- Quando acionar a release (tag `v*.*.*` no git)
- Se uma release candidate é necessária antes da publicação

**O que não precisa conhecer:**
- Detalhes de implementação dos workflows individuais
- Estado operacional de projetos que usam OXE

**Checklist de release:**
```bash
# 1. Bump de versão
#    Atualizar: package.json, README.md, CHANGELOG.md

# 2. Validar
npm test
npm run scan:assets
node bin/oxe-cc.js doctor
node bin/oxe-cc.js --version

# 3. Dry-run
npm publish --dry-run

# 4. Tag e push (dispara release.yml automaticamente)
git tag v1.x.0
git push origin v1.x.0
```
