<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-4 — Governança de release unificada, retomada idempotente pós-reinício e rastreio multi-PR OXE-Part-Of (G04/G05/G06/G07/G08/G11/G17)

- **Status:** Aceita
- **Data:** 2026-11-26
- **Critérios:** A11, A12, A13, A14, A15, A16, A17
- **Por:** arquitetura

## Contexto

Colisões de migração 106 e ratchets, ejeções 5xx no merge train, drift B1.4 em spec congelada e fechamento manual de releases/épicos na 1.6.0/1.6.1.

## Decisão

Comandos sync, acceptance-audit, release-readiness, release-finalize, autoresume reconcile e marcador OXE-Part-Of: KEY (k/N) + checkEpicClosure fecham o ciclo ponta a ponta.

## Consequências

Operações destrutivas padrão --dry-run, finalização e retomada 100% idempotentes, retry com backoff somente em infra transitória.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
