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

## Contexto

- Repositório / produto: …
- Links úteis: …

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

## Suposições

- …

## Riscos

- …

## Referências no código

- Caminhos / módulos: …

---

## Secções opcionais — brownfield / migração legado

> Use quando o projeto for mainframe + desktop legado ou documentação de migração. Podem ser exigidas pelo `doctor` via `spec_required_sections` em `.oxe/config.json`. Ver `oxe/workflows/references/legacy-brownfield.md`.

### Contratos de dados

- Copybooks, tabelas, mensagens, layouts de ficheiro.

### Fluxos batch

- Cadeias JCL / jobs e programas associados.

### Integrações desktop-DB

- Cliente (ex. VB6) ↔ base de dados / stored procedures.
