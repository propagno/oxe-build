---
oxe_doc: prd
status: draft
version: 1
updated: YYYY-MM-DD
---

<!--
  Template OXE — PRD.md (documento de produto, acima da SPEC)
  - O PRD diz POR QUE e PARA QUEM; a SPEC diz O QUE e COMO SE VERIFICA.
  - Histórias US-n são estáveis: o plano, o verify e o ALM (Jira / Azure DevOps) as referenciam pelo ID.
  - Cada história aponta para os requisitos (R*) e critérios (A*) da SPEC que a entregam.
  - Mudança de escopo: nova versão (version: 2), com a linha em "Histórico de versões"; nunca reescrever o passado.
  - `oxe-cc prd lint` confere a rastreabilidade; `oxe-cc alm push` cria as histórias no Jira ou no Azure DevOps.
-->

# PRD — (nome do produto ou da entrega)

## Problema

(2–4 frases: qual dor, de quem, com que frequência, e o custo de não resolver.)

## Personas

| Persona | Quem é | O que precisa |
|---------|--------|---------------|
| (ex.: Operador) | (contexto de uso) | (necessidade principal) |

## Objetivos e métricas de sucesso

| ID | Objetivo | Métrica | Meta | Como medir |
|----|----------|---------|------|------------|
| M-1 | (ex.: reduzir o tempo de envio) | (ex.: p95 do envio) | (ex.: < 2 s) | (ex.: telemetria do app) |

## Histórias de usuário

| ID | Como | Quero | Para | Requisitos | Critérios | Prioridade |
|----|------|-------|------|------------|-----------|------------|
| US-1 | (persona) | (ação) | (benefício) | R1 | A1, A2 | Must |

## Fora de escopo

- (o que não entra, e por quê)

## Premissas e riscos de negócio

- (premissa ou risco, com o impacto se falhar)

## Histórico de versões

| Versão | Data | Mudança | Origem |
|--------|------|---------|--------|
| 1 | YYYY-MM-DD | versão inicial | /oxe-spec |
