---
oxe_doc: spec
status: draft
updated: YYYY-MM-DD
inputs: []
---

<!--
  Metadados OXE (retomada após contexto longo). Manter o bloco --- acima ANTES do primeiro #.
  - status: draft | ready | superseded (guia humano; não validado por schema)
  - inputs: paths ou URLs que alimentaram a spec (PRD, issues, branches)
-->

# OXE — Especificação

> Substitua os placeholders. Remova seções vazias se não se aplicarem.

## Objetivo

(Uma frase: o que entregar.)

## Outcome esperado

- Usuário ou operador principal: …
- Resultado observável ao final da entrega: …
- Medida de sucesso principal: …

## Contexto

- Repositório / produto: …
- Links úteis: …
- Tipo de demanda: feature | bugfix | refactor | research | ops | mixed
- Incertezas estruturadas: …
- Restrições técnicas obrigatórias: …
- Tecnologias proibidas ou evitadas: …

## Público e experiência

- Público-alvo primário: …
- Nível de conhecimento esperado: iniciante | intermediário | avançado
- Contexto de uso: desktop | mobile | ambos | CLI | backoffice | batch
- Tom ou padrão de experiência esperado: …

## Escopo

### Dentro do escopo

- …

### Fora do escopo (não objetivos)

- …

## Critérios de aceite

Use **IDs estáveis** (A1, A2, …) para o plano e o verify vincularem cada tarefa a um critério. Cada critério deve ser **testável ou observável** (comando, checklist ou critério objetivo).

| ID | Critério | Como verificar |
|----|----------|----------------|
| A1 | (ex.: Dado … quando … então …) | (ex.: `npm test`, teste manual X) |
| A2 | … | … |

## Setup externo e pré-condições

- Contas, variáveis de ambiente, filas, bancos, VPN, dashboards ou recursos cloud necessários: …
- Pré-condições bloqueantes para executar ou validar: …

## Conteúdo e fluxos obrigatórios

- Fluxos obrigatórios da v1: …
- Estados obrigatórios: loading | empty | error | success | disabled | not_applicable
- Conteúdo mínimo obrigatório por área/módulo: …
- Exemplos concretos que devem existir na entrega: …

## Entradas visuais e interpretação

- Status: ready | partial | blocked | not_applicable
- Artefato visual: `.oxe/investigations/visual/VISUAL-INPUTS.md` | not_applicable
- Imagens/anexos usados como fonte: …
- Capacidade visual do runtime hospedeiro: supported | unsupported | unknown
- Requisitos derivados de imagem: R-ID/A* | not_applicable
- Ambiguidades visuais ainda abertas: …
- Observação: se a imagem for crítica para UI, layout, fluxo ou regra funcional, `VISUAL-INPUTS` precisa estar pronto antes do PLAN sustentar confiança > 90%.

## Suposições

- …

## Riscos

- …

## Referências no código

- Caminhos / módulos: …

## Contratos esperados para o plano

- Arquivos ou áreas que o plano deverá fechar com write-set explícito: …
- Fixtures, anchors ou exemplos locais obrigatórios antes de executar: …
- Decisões que não podem ser deixadas para o executor: …

---

## Secções opcionais — brownfield / migração legado

> Use quando o projeto for mainframe + desktop legado ou documentação de migração. Podem ser exigidas pelo `doctor` via `spec_required_sections` em `.oxe/config.json`. Ver `oxe/workflows/references/legacy-brownfield.md`.

### Contratos de dados

- Copybooks, tabelas, mensagens, layouts de ficheiro.

### Fluxos batch

- Cadeias JCL / jobs e programas associados.

### Integrações desktop-DB

- Cliente (ex. VB6) ↔ base de dados / stored procedures.
