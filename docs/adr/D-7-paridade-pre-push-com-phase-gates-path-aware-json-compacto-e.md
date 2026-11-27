<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-7 — Paridade pre-push com phase_gates path-aware, JSON compacto e sync version_pins

- **Status:** Aceita
- **Data:** 2026-11-27
- **Por:** architect

## Contexto

No ciclo OXESpace v1.6.3, 55-70% do leadtime ocorreu pos-PR por descolamento entre verify local e guardas globais de CI, payloads --json >2 MB truncados no terminal e colisoes seriais de migracoes SQLite com pinos de versao.

## Decisão

Adotar phase_gates path-aware e preflight.triggers no runtime verify, saida --json compacta por padrao com --full opt-in, e atualizacao atomica de sync.version_pins no oxe-cc sync e runtime promote.

## Consequências

Reduz retrabalho de CI antes do primeiro push mantendo core 100% agnostico; preserva janela de contexto do agente gravando verify-full.json em disco; automatiza renumeracao e bump de version_pins no promote sem edicao manual.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
