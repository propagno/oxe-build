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

**Campos obrigatórios de cada lição:**
```
- **Lição C-NN-L1:** <instrução prescritiva — o que fazer diferente>
- **Raiz:** <por que aconteceu>
- **Tipo:** spec | plan | execute | verify | process | agents
- **Aplicar em:** /oxe-spec | /oxe-plan | /oxe-execute | etc.
- **Status:** ativo | resolvido
- **Frequência:** N  ← quantos ciclos registraram ou confirmaram esta lição
- **Impacto:** alto | médio | baixo  ← criticidade se repetida
- **Última aplicação:** YYYY-MM-DD
```

**Regras de scoring:**
- **Frequência:** começa em `1`. A cada novo ciclo em que a mesma lição se repete (mesma raiz + tipo), incrementar `Frequência: N+1` e atualizar `Última aplicação` **em vez de criar entrada duplicada**.
- **Impacto alto:** causou retrabalho de ciclo inteiro, falha no verify, ou seria crítico se repetido — tipo auth, schema, contrato público.
- **Impacto médio:** causou atraso ou retrabalho localizado (1–3 tarefas).
- **Impacto baixo:** menor, já tem mitigação óbvia, ou restrito a contexto muito específico.

**Como os consumidores usam o scoring (instrução para spec e plan):**
Ao ler `LESSONS.md`, priorizar entradas com **`Frequência >= 2`** ou **`Impacto: alto`** — aplicar como restrições explícitas. Lições com `Frequência: 1` e `Impacto: baixo` são contexto secundário.
</taxonomy>

<process>
1. Ler **`.oxe/VERIFY.md`** se existir: identificar tarefas que falharam, critérios A* sem evidência, gaps documentados.
2. Ler **`.oxe/FORENSICS.md`** se existir: capturar causa raiz de falhas de execução.
3. Ler **`.oxe/SUMMARY.md`** se existir: capturar contexto de replans e decisões forçadas.
4. Ler **`.oxe/STATE.md`**: capturar número de ondas, execute_mode usado, se houve loop, se houve escalação para forensics.
5. Sintetizar **3–5 lições prescritivas** (não mais — qualidade sobre quantidade):
   - Cada lição responde: "O que o próximo ciclo deve fazer diferente?"
   - Formato: **Lição** + **Raiz** + **Tipo** + **Aplicar em** + **Frequência** + **Impacto** (ver taxonomia)
   - Avaliar impacto: `alto` se causou retrabalho de ciclo/falha crítica; `médio` se localizado; `baixo` se menor
6. Determinar o próximo **ciclo ID** (C-NN) lendo `.oxe/LESSONS.md` existente ou começando em C-01.
7. Criar ou atualizar **`.oxe/LESSONS.md`** usando `oxe/templates/LESSONS.template.md`:
   - **Antes de adicionar:** verificar se alguma lição de ciclo anterior tem a mesma raiz e tipo. Se sim, **incrementar `Frequência`** e atualizar `Última aplicação: YYYY-MM-DD` nessa entrada existente — **não duplicar**.
   - Apenas entradas genuinamente novas recebem uma nova linha na tabela de índice (mais recente primeiro).
   - Adicionar seção `### C-NN` com as lições novas do ciclo (ou referência às entradas incrementadas).
   - **Nunca apagar** entradas anteriores — só mudar `Status: resolvido` se a lição foi definitivamente superada.
8. **Atualizar `.oxe/lessons-metrics.json`** (se existir) ou criar se LESSONS.md já tiver entradas:
   - Para cada lição nova ou incrementada neste ciclo, verificar se já existe entrada em `lessons-metrics.json` com o mesmo `id` (L-NN).
   - Se existe: chamar `updateLessonMetric` com `{ cycle: "C-NN", verify_status: "<verify_complete|verify_failed>", saved_hours: <estimativa ou 0> }`.
   - Se não existe: criar nova entrada com `applied_cycles: ["C-NN"]`, `outcomes: [...]`, `success_rate: 1.0` (ou `0.0` se falhou), `status: "active"`, `deprecation_threshold: 0.5`.
   - Lições com `success_rate < 0.5` e ≥ 3 observações → marcar `status: "deprecated"` e registrar aviso no chat.
9. Atualizar **`.oxe/STATE.md`**: campo `last_retro: YYYY-MM-DD`.
10. Responder no chat: ID do ciclo (C-NN), número de lições registradas, lição mais crítica em 1 frase, lições depreciadas (se houver), sugestão do próximo ciclo (`/oxe-scan` ou `/oxe-spec`).
</process>

<success_criteria>
- [ ] `.oxe/LESSONS.md` existe com entrada C-NN na tabela e seção de detalhe.
- [ ] Cada lição é prescritiva (diz o que fazer) não descritiva (não é só o que aconteceu).
- [ ] 3–5 lições por ciclo — não um dump completo de eventos.
- [ ] Cada lição tem campos `Frequência`, `Impacto` e `Última aplicação` preenchidos.
- [ ] Lições com raiz e tipo iguais a entradas anteriores têm `Frequência` incrementada, não duplicadas.
- [ ] `STATE.md` tem `last_retro` atualizado.
- [ ] Entradas anteriores preservadas; apenas `Status` pode mudar para `resolvido`.
</success_criteria>
