# OXE — Workflow: execute

<objective>
Guiar a **implementação por ondas** com base em **`.oxe/PLAN.md`**, atualizando **`.oxe/STATE.md`** com progresso (tarefas Tn). Não substitui o editor: estrutura o trabalho e confirma pré-requisitos antes de cada onda.

Se existir apenas **`.oxe/QUICK.md`** (fluxo quick), tratar os **Passos** numerados como lista única “onda 1” em vez de tarefas T1…Tn.
</objective>

<context>
- Se **PLAN.md** não existir mas **QUICK.md** existir, seguir **QUICK.md** neste workflow (passos = trabalho da sessão).
- Se nem PLAN nem QUICK existir, recomendar `oxe:plan` ou `oxe:quick` primeiro.
</context>

<process>
1. Ler `.oxe/STATE.md`, `PLAN.md` (se existir) e `QUICK.md` (se PLAN não existir).
2. Identificar **onda atual** (ou próxima): no PLAN, todas as tarefas da mesma **Onda** sem dependências pendentes; no QUICK, os passos ainda não marcados como feitos (se STATE não indicar, assumir desde o início).
3. Listar no chat: tarefas/passos desta onda, ficheiros prováveis, comando **Verificar** associado (do PLAN ou do QUICK).
4. Após o utilizador confirmar que a onda foi implementada (ou após aplicares as mudanças tu mesmo), atualizar **`.oxe/STATE.md`**:
   - Secção ou bullets: **Última onda executada**, **Tarefas concluídas** (Tn ou números dos passos).
   - Próximo passo: continuar próxima onda, `oxe:verify`, ou `oxe:plan` se o plano ficou obsoleto.
5. Se o PLAN tiver várias ondas, repetir execute por onda sob pedido; não apagar tarefas do PLAN.
</process>

<success_criteria>
- [ ] Onda ou bloco de passos está explícito antes de “implementar”.
- [ ] `STATE.md` regista progresso (Tn ou passos) e próximo passo.
- [ ] Verificação alinhada ao bloco **Verificar** do PLAN ou QUICK.
</success_criteria>
