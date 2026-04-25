---
oxe_doc: plan
status: draft
updated: YYYY-MM-DD
inputs: []
spec_version: ""
plan_confidence_threshold: 90
goal_backward_verification: required
rationality_gate: required
risk_level: low | medium | high | critical
autonomous: false
must_haves: []
dependencies: []
checkpoints: []
evidence_expectation: manifest | command | manual | mixed
---

<!--
  Metadados OXE. Manter --- antes do primeiro #. Atualize `updated` a cada revisão significativa.
  inputs: ligações a SPEC, tickets ou branches que orientaram o plano.
-->

# OXE — Plano

> Gerado a partir de `.oxe/SPEC.md`. Cada tarefa deve ter bloco **Verificar**.

## Resumo

- **Spec vinculada:** (data ou versão informal)
- **Ondas:** (número)
- **Tarefas:** (número)
- **Artefatos racionais:** `IMPLEMENTATION-PACK`, `REFERENCE-ANCHORS`, `FIXTURE-PACK`

## Autoavaliação do Plano

- **Melhor plano atual:** sim
- **Confiança:** 92%
- **Limiar para execute:** > 90%
- **Resultado do gate racional:** ready | not_ready
- **Base da confiança:**
  - Completude dos requisitos: 23/25
  - Dependências conhecidas: 14/15
  - Risco técnico: 18/20
  - Impacto no código existente: 14/15
  - Clareza da validação / testes: 14/15
  - Lacunas externas / decisões pendentes: 9/10
- **Principais incertezas:** (0–3 bullets)
- **Alternativas descartadas:** (1–2 linhas)
- **Condição para replanejar:** (critério objetivo)
- **Bloqueadores de execução:** nenhum | listar gaps críticos

<confidence_vector cycle="C-NN" generated_at="YYYY-MM-DDTHH:MM:SSZ">
  <dim name="requirements"   score="0.92" weight="25" note="completude dos requisitos" />
  <dim name="dependencies"   score="0.93" weight="15" note="dependências conhecidas" />
  <dim name="technical_risk" score="0.90" weight="20" note="risco técnico — ajustar se H* pendentes" />
  <dim name="code_impact"    score="0.93" weight="15" note="impacto no código existente" />
  <dim name="validation"     score="0.93" weight="15" note="clareza da validação / testes" />
  <dim name="open_gaps"      score="0.90" weight="10" note="lacunas externas / decisões pendentes" />
  <global score="0.92" gate="proceed" />
</confidence_vector>

<!--
  gate possíveis: proceed | proceed_with_risk | refine_first | blocked
  Atualizar este bloco a cada replanejamento; o campo cycle deve coincidir com o ciclo atual.
-->

## Hipóteses Críticas

<!--
  Obrigatório quando houver tarefas L/XL ou dependências de libs externas/APIs.
  Omitir se todas as tarefas forem S/M e sem dependências não verificadas.
  Usar tags XML para extração pelo context engine (ver oxe/templates/HYPOTHESES.template.md).
-->

<!-- Exemplo (remover se não houver hipóteses):
<hypothesis id="H1" checkpoint="T2" status="pending">
  <condition>lib X disponível no npm sem conflito de versão</condition>
  <validation>npm install X && node -e "require('X')"</validation>
  <on_failure>bloquear T2, avaliar alternativa Y</on_failure>
</hypothesis>
-->

## Dependências globais

- (ex.: branch base, feature flags, migrations)

## Artefatos racionais de execução

- **IMPLEMENTATION-PACK:** `ready | not_ready | not_applicable`
- **REFERENCE-ANCHORS:** `ready | not_ready | not_applicable`
- **FIXTURE-PACK:** `ready | not_ready | not_applicable`
- **Critical gaps abertos:** (nenhum | listar IDs/causas)

### Contrato goal-backward

| Critério | Evidência esperada | Tarefa(s) | Risco se falhar |
|----------|--------------------|-----------|-----------------|
| A1 | comando, arquivo, fixture ou UAT | T1 | high |

### Must-haves de execução

- Nenhuma tarefa mutável com path ambíguo.
- Nenhum símbolo alvo indefinido.
- Nenhuma referência crítica não materializada.
- Nenhuma tarefa de parsing/integração/transformação sem fixture ou justificativa `not_applicable`.
- Nenhum checkpoint humano pendente antes de side effect crítico.

## Replanejamento

> Preencher apenas em **--replan** ou após verify falhado. Manter histórico legível.

- **Data / motivo:** …
- **Lições de VERIFY / SUMMARY:** …
- **Alterações ao plano anterior:** (tarefas removidas, novas, renumeradas) …

## Tarefas

### T1 — (título)

- **Arquivos alvo:** `src/exato.ts`
- **Depende de:** —
- **Onda:** 1
- **Complexidade:** S
- **Risco:** low | medium | high | critical
- **Evidência de entrada:** SPEC A1 | DISCUSS D-01 | RESEARCH RA-01 | codebase path
- **Checkpoint:** nenhum | CHK-01
- **Verificar:**
  - Comando: `…`
  - Manual: (opcional) …
- **Implementar:** o mínimo para fazer a verificação acima passar.
- **Aceite vinculado:** A1, A2 (IDs da tabela de critérios em SPEC.md)
- **Contrato racional:** ver `IMPLEMENTATION-PACK.json` (task `T1`)
- **Rollback/contensão:** obrigatório para risco high/critical; `not_applicable` se low/medium.

---

_(Adicione T2, T3, … conforme o comando oxe:plan.)_
