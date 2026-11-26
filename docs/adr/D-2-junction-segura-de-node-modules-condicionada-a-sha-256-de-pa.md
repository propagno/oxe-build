<!-- oxe-adr:begin (gerado de .oxe/program/decisions.ndjson — edite fora deste bloco) -->
# D-2 — Junction segura de node_modules condicionada a SHA-256 de package-lock.json e integridade de pacotes (G03/G15)

- **Status:** Aceita
- **Data:** 2026-11-26
- **Critérios:** A3, A4
- **Por:** arquitetura

## Contexto

Junctions defasadas sem ws/katex/mermaid/@xterm/addon-serialize geraram 12 falsos erros TS2307/TS2353 e npm ci paralelo saturava disco/RAM.

## Decisão

bin/lib/oxe-worktree-deps.cjs valida SHA-256 normalizado em LF de package-lock.json e presença dos pacotes declarados antes de criar junction/symlink.

## Consequências

Falha rápida e determinística quando o lockfile diverge ou pacotes faltam na origem; 0 duplicação de node_modules em worktrees paralelas.

## Evidência

_Sem comando de verificação: esta decisão não é conferida automaticamente._

<!-- oxe-adr:end -->

## Notas

_(texto livre — preservado a cada publicação)_
