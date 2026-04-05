# OXE — Workflow: retro (retrospectiva de ciclo)

<objective>
Sintetizar os aprendizados de um ciclo completo (spec → verify) em **`.oxe/LESSONS.md`** — um arquivo prescritivo e cumulativo que alimenta automaticamente ciclos futuros.

**Princípio:** lições não são diário — são instruções para o próximo ciclo. Cada entrada diz COMO agir diferente, não apenas o que aconteceu.

Pode ser chamado:
- Após `/oxe-verify` (ciclo normal completo)
- Após `/oxe-verify` com falha e replanejamento (ciclo com retrabalho)
- A qualquer momento para capturar aprendizados antes que se percam
</objective>

<context>
- **Pré-requisito preferível:** `.oxe/VERIFY.md` existente. Sem ele, a retro é baseada em STATE.md e relato do usuário.
- **Artefato:** `.oxe/LESSONS.md` — append-only por padrão; nunca apagar entradas anteriores, apenas mudar `Status` para `resolvido`.
- **Consumidores:** `/oxe-spec` (lições tipo `spec`), `/oxe-plan` (lições tipo `plan`), `/oxe-scan` (lições tipo `process`), `/oxe-execute` (lições tipo `execute`).
- **Ciclo ID:** sequencial `C-01`, `C-02`, … (continuar do último em LESSONS.md).
- Template: `oxe/templates/LESSONS.template.md`.
</context>

<taxonomy>
## Taxonomia de tipos de lição

| Tipo | Quando usar | Consumido por |
|------|-------------|---------------|
| `spec` | Problemas na definição de requisitos ou critérios A* | `/oxe-spec` Fase 1/3 |
| `plan` | Problemas de granularidade, ondas, verificações | `/oxe-plan` |
| `execute` | Padrões de falha na implementação, hipóteses erradas | `/oxe-execute` |
| `verify` | Critérios vagos, evidências insuficientes, camadas puladas | `/oxe-verify` |
| `process` | Escolha errada de workflow (quick vs spec, solo vs agents) | `/oxe-scan`, qualquer entry |
| `agents` | Problemas de orquestração, runId, dependências de agente | `/oxe-plan-agent`, `/oxe-execute` |

**Formato de lição (prescritivo, não descritivo):**
- ❌ "A tarefa T4 demorou muito" (descritivo — não ajuda no próximo ciclo)
- ✅ "Tarefas com integração de terceiros devem ter Complexidade L mínimo + Verificar com mock fallback" (prescritivo — o próximo plan pode aplicar)
</taxonomy>

<process>
1. Ler **`.oxe/VERIFY.md`** se existir: identificar tarefas que falharam, critérios A* sem evidência, gaps documentados.
2. Ler **`.oxe/FORENSICS.md`** se existir: capturar causa raiz de falhas de execução.
3. Ler **`.oxe/SUMMARY.md`** se existir: capturar contexto de replans e decisões forçadas.
4. Ler **`.oxe/STATE.md`**: capturar número de ondas, execute_mode usado, se houve loop, se houve escalação para forensics.
5. Sintetizar **3–5 lições prescritivas** (não mais — qualidade sobre quantidade):
   - Cada lição responde: "O que o próximo ciclo deve fazer diferente?"
   - Formato: **Lição** (o que fazer) + **Raiz** (por que isso aconteceu) + **Tipo** + **Aplicar em**
6. Determinar o próximo **ciclo ID** (C-NN) lendo `.oxe/LESSONS.md` existente ou começando em C-01.
7. Criar ou atualizar **`.oxe/LESSONS.md`** usando `oxe/templates/LESSONS.template.md`:
   - Adicionar linha na tabela de índice (mais recente primeiro).
   - Adicionar seção `### C-NN` com as lições sintetizadas.
   - **Nunca apagar** entradas anteriores — só mudar `Status: resolvido` se a lição foi superada.
8. Atualizar **`.oxe/STATE.md`**: campo `last_retro: YYYY-MM-DD`.
9. Responder no chat: ID do ciclo (C-NN), número de lições registradas, lição mais crítica em 1 frase, sugestão do próximo ciclo (`/oxe-scan` ou `/oxe-spec`).
</process>

<success_criteria>
- [ ] `.oxe/LESSONS.md` existe com entrada C-NN na tabela e seção de detalhe.
- [ ] Cada lição é prescritiva (diz o que fazer) não descritiva (não é só o que aconteceu).
- [ ] 3–5 lições por ciclo — não um dump completo de eventos.
- [ ] `STATE.md` tem `last_retro` atualizado.
- [ ] Entradas anteriores preservadas; apenas `Status` pode mudar.
</success_criteria>
