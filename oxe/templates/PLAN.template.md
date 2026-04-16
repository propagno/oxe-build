---
oxe_doc: plan
status: draft
updated: YYYY-MM-DD
inputs: []
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

## Autoavaliação do Plano

- **Melhor plano atual:** sim
- **Confiança:** 80%
- **Base da confiança:**
  - Completude dos requisitos: 20/25
  - Dependências conhecidas: 12/15
  - Risco técnico: 15/20
  - Impacto no código existente: 12/15
  - Clareza da validação / testes: 13/15
  - Lacunas externas / decisões pendentes: 8/10
- **Principais incertezas:** (0–3 bullets)
- **Alternativas descartadas:** (1–2 linhas)
- **Condição para replanejar:** (critério objetivo)

<confidence_vector cycle="C-NN" generated_at="YYYY-MM-DDTHH:MM:SSZ">
  <dim name="requirements"   score="0.80" weight="25" note="completude dos requisitos" />
  <dim name="dependencies"   score="0.80" weight="15" note="dependências conhecidas" />
  <dim name="technical_risk" score="0.75" weight="20" note="risco técnico — ajustar se H* pendentes" />
  <dim name="code_impact"    score="0.80" weight="15" note="impacto no código existente" />
  <dim name="validation"     score="0.87" weight="15" note="clareza da validação / testes" />
  <dim name="open_gaps"      score="0.80" weight="10" note="lacunas externas / decisões pendentes" />
  <global score="0.80" gate="proceed_with_risk" />
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

## Replanejamento

> Preencher apenas em **--replan** ou após verify falhado. Manter histórico legível.

- **Data / motivo:** …
- **Lições de VERIFY / SUMMARY:** …
- **Alterações ao plano anterior:** (tarefas removidas, novas, renumeradas) …

## Tarefas

### T1 — (título)

- **Arquivos prováveis:** `…`
- **Depende de:** —
- **Onda:** 1
- **Complexidade:** S
- **Verificar:**
  - Comando: `…`
  - Manual: (opcional) …
- **Implementar:** o mínimo para fazer a verificação acima passar.
- **Aceite vinculado:** A1, A2 (IDs da tabela de critérios em SPEC.md)

---

_(Adicione T2, T3, … conforme o comando oxe:plan.)_
