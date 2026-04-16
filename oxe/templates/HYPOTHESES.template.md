---
oxe_doc: hypotheses
status: draft
updated: YYYY-MM-DD
---

<!--
  Hipóteses Críticas OXE — seção opcional do PLAN.md para tarefas L/XL ou
  com dependências externas. Cada hipótese deve ser validada antes do
  checkpoint declarado; se refutada, registrar bloqueio explícito antes de
  qualquer mutação.

  Formato recomendado: tags XML dentro do MD (para extração pelo context engine)
  com tabela resumida abaixo para leitura humana.

  Status possíveis: pending | validated | refuted | skipped
-->

## Hipóteses Críticas

<hypothesis id="H1" checkpoint="T2" status="pending">
  <condition>Descrever a premissa que precisa ser verdadeira para avançar</condition>
  <validation>Comando ou inspeção que prova/refuta a hipótese (ex: npm install && node test/auth.cjs)</validation>
  <on_failure>O que fazer se refutada (ex: bloquear T2, abrir pesquisa de alternativa, replanejar)</on_failure>
</hypothesis>

<!-- Adicionar mais blocos <hypothesis> conforme necessário -->

### Tabela resumida

| ID  | Hipótese               | Checkpoint | Status  |
|-----|------------------------|------------|---------|
| H1  | (descrição da premissa)| antes de T?| pending |
