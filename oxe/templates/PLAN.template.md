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
